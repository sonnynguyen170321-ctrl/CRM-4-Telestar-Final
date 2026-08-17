import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasScope } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { LeadStage } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/calls
 * Log a VOIP phone call from an external dialer (Aircall, Twilio, JustCall, CloudCall).
 * Creates a call activity, attaches recordings, and updates lead stage.
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  if (!hasScope(user, 'calls:write') && !hasScope(user, 'activities:write')) {
    return NextResponse.json(
      { error: 'Forbidden: missing calls:write or activities:write scope' },
      { status: 403 }
    );
  }

  const tenantId = user.tenantId!;
  const body = await req.json();
  const {
    leadId,
    phone,
    email,
    direction = 'outbound',
    durationSeconds = 0,
    outcome = 'connected',
    recordingUrl,
    notes,
    callerPhone,
  } = body;

  // 1. Locate the lead
  let lead = null;
  if (leadId) {
    lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
    });
  } else if (phone) {
    lead = await prisma.lead.findFirst({
      where: { phone: { contains: phone.trim() }, tenantId },
    });
  } else if (email) {
    lead = await prisma.lead.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, tenantId },
    });
  }

  if (!lead) {
    return NextResponse.json(
      { error: 'Lead not found in CRM. Provide valid leadId, phone, or email.' },
      { status: 404 }
    );
  }

  // 2. Format description & metadata
  const durationMin = Math.floor(durationSeconds / 60);
  const durationSec = durationSeconds % 60;
  const durationStr = `${durationMin}m ${durationSec}s`;

  const description = `📞 [VOIP Call] ${direction.toUpperCase()} (${durationStr}) - Outcome: ${outcome.toUpperCase()}${
    notes ? `\nNotes: ${notes}` : ''
  }${recordingUrl ? `\n🎙️ Audio Recording: ${recordingUrl}` : ''}`;

  // 3. Create Activity
  const activity = await tenantStorage.run({ tenantId }, () =>
    prisma.activity.create({
      data: {
        type: 'call_logged',
        channel: 'phone',
        description,
        leadId: lead.id,
        userId: user.id,
        tenantId,
        metadata: {
          voip: true,
          direction,
          durationSeconds,
          outcome,
          recordingUrl: recordingUrl || null,
          callerPhone: callerPhone || null,
          loggedVia: user.apiKey ? `api_key:${user.apiKey.name}` : 'session',
        },
      },
    })
  );

  // 4. Update Lead Stage based on call outcome
  let nextStage: LeadStage = lead.stage;
  if (outcome === 'meeting_booked') {
    nextStage = 'meeting_booked';
  } else if (outcome === 'connected' && (lead.stage === 'new' || lead.stage === 'sequence_active')) {
    nextStage = 'replied';
  }

  if (nextStage !== lead.stage) {
    await tenantStorage.run({ tenantId }, () =>
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          stage: nextStage,
          updatedAt: new Date(),
        },
      })
    );
  }

  return NextResponse.json(
    {
      success: true,
      activityId: activity.id,
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      updatedStage: nextStage,
      message: 'Call activity logged successfully.',
    },
    { status: 201 }
  );
}
