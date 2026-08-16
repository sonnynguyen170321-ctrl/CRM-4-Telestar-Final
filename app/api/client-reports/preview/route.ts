import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canReferenceClient, canReferenceCampaign } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { previewClientReportSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { canCreateClientReport } from '@/lib/client-reports/access';
import { buildReportMetrics } from '@/lib/client-reports/metrics';

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // Same gate as `POST /api/client-reports`. A preview returns the identical metrics the stored
  // report would have carried, so a role that may not generate a report may not generate its
  // contents either — otherwise preview is simply the unguarded way to read them.
  if (!canCreateClientReport(user)) {
    return NextResponse.json({ error: 'Forbidden: Insufficient role to generate reports' }, { status: 403 });
  }

  const parsed = await parseBody(req, previewClientReportSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // Validated before `buildReportMetrics` runs, for the same reason the create route validates
  // first — the builder computes aggregates over whatever client was named. Persisting nothing is
  // not the mitigation it appears to be: the response body *is* the disclosure. Measured before
  // this existed: naming another tenant's client returned 200 with that tenant's name and numbers.
  const clientCheck = await canReferenceClient(user, body.clientId);
  if (clientCheck === 'not_found') {
    // Foreign and nonexistent answer alike, so the status never confirms a client exists elsewhere.
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (clientCheck === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (body.campaignId) {
    const campaignCheck = await canReferenceCampaign(user, body.campaignId);
    if (campaignCheck === 'not_found') {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    if (campaignCheck === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Relational consistency rather than authorization: both references are in-tenant and the
    // caller may name each. Previewing one client's report through another client's campaign is
    // incoherent, and the preview is what a reviewer approves before it reaches a customer.
    const campaign = await prisma.campaign.findFirst({
      where: { id: body.campaignId },
      select: { clientId: true },
    });
    if (campaign && campaign.clientId !== body.clientId) {
      return NextResponse.json(
        { error: 'The campaign does not belong to the supplied client' },
        { status: 422 }
      );
    }
  }

  try {
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0];

    const snapshot = await buildReportMetrics({
      clientId: body.clientId,
      campaignId: body.campaignId,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      audience: body.audience,
      sdrDisplayMode: body.sdrDisplayMode,
      generatedById: user.id,
      generatedByName: userName,
    });

    return NextResponse.json({ snapshot });
  } catch (error) {
    return handleApiError('Failed to generate report preview', error);
  }
}
