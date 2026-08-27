import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasScope } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/leads
 * Query and search leads for VOIP dialers or external workflows.
 */
export async function GET(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  if (!hasScope(user, 'leads:read')) {
    return NextResponse.json({ error: 'Forbidden: missing leads:read scope' }, { status: 403 });
  }

  const tenantId = user.tenantId!;
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';
  const email = searchParams.get('email')?.trim() || '';
  const phone = searchParams.get('phone')?.trim() || '';
  const campaignId = searchParams.get('campaignId') || undefined;
  const stage = searchParams.get('stage') || undefined;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);

  const where: any = {
    tenantId,
  };

  if (campaignId) where.campaignId = campaignId;
  if (stage) where.stage = stage;
  if (email) where.email = { contains: email, mode: 'insensitive' };
  if (phone) where.phone = { contains: phone };

  if (query) {
    where.OR = [
      { firstName: { contains: query, mode: 'insensitive' } },
      { lastName: { contains: query, mode: 'insensitive' } },
      { company: { contains: query, mode: 'insensitive' } },
      { email: { contains: query, mode: 'insensitive' } },
      { phone: { contains: query } },
    ];
  }

  const leads = await prisma.lead.findMany({
    where,
    take: limit,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      company: true,
      title: true,
      stage: true,
      crmPriorityScore: true,
      engagementScore: true,
      linkedIn: true,
      campaignId: true,
      campaign: {
        select: {
          id: true,
          name: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    count: leads.length,
    leads,
  });
}

/**
 * POST /api/v1/leads
 * Ingest / create a lead from external research or leadgen tools (Clay, Apollo, ZoomInfo).
 */
export async function POST(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  if (!hasScope(user, 'leads:write')) {
    return NextResponse.json({ error: 'Forbidden: missing leads:write scope' }, { status: 403 });
  }

  const tenantId = user.tenantId!;
  const body = await req.json();
  const {
    firstName,
    lastName,
    email,
    phone,
    company,
    title,
    campaignId,
    linkedinUrl,
    linkedIn,
    notes,
  } = body;

  if (!firstName || !company || !email) {
    return NextResponse.json(
      { error: 'Missing required fields: firstName, email, and company are required' },
      { status: 400 }
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const resolvedLinkedIn = linkedinUrl || linkedIn || null;

  // 1. Check for existing lead by email within tenant
  const existing = await prisma.lead.findFirst({
    where: {
      tenantId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
    },
  });

  if (existing) {
    // Update existing lead with newly researched info
    const updated = await tenantStorage.run({ tenantId }, () =>
      prisma.lead.update({
        where: { id: existing.id },
        data: {
          phone: phone || existing.phone,
          title: title || existing.title,
          linkedIn: resolvedLinkedIn || existing.linkedIn,
        },
      })
    );

    return NextResponse.json(
      {
        lead: updated,
        action: 'updated_existing',
        message: 'Lead already exists in CRM. Updated with new fields.',
      },
      { status: 200 }
    );
  }

  // 2. Resolve default campaign if not provided
  let targetCampaignId = campaignId;
  if (!targetCampaignId) {
    const defaultCampaign = await prisma.campaign.findFirst({
      where: { tenantId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    if (defaultCampaign) {
      targetCampaignId = defaultCampaign.id;
    }
  }

  if (!targetCampaignId) {
    return NextResponse.json(
      { error: 'No active campaign found in tenant. Please supply campaignId.' },
      { status: 400 }
    );
  }

  // 3. Create lead
  const newLead = await tenantStorage.run({ tenantId }, () =>
    prisma.lead.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName ? lastName.trim() : '',
        email: normalizedEmail,
        normalizedEmail,
        phone: phone ? phone.trim() : null,
        company: company.trim(),
        title: title ? title.trim() : null,
        linkedIn: resolvedLinkedIn ? resolvedLinkedIn.trim() : null,
        campaignId: targetCampaignId,
        tenantId,
        assignedToId: user.id,
        stage: 'new',
        crmPriorityScore: 'warm',
        engagementScore: 50,
        // The nested Note takes its tenant from the Lead through the composite
        // (leadId, tenantId) key, so it no longer accepts a tenantId of its own.
        notes: notes ? { create: { content: notes, createdById: user.id } } : undefined,
      },
    })
  );

  return NextResponse.json(
    {
      lead: newLead,
      action: 'created',
      message: 'Lead ingested successfully into CRM.',
    },
    { status: 201 }
  );
}
