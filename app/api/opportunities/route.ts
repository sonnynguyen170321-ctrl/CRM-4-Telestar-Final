import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManager, getVisibleUserIds, getVisibleCampaignIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody, capLimit } from '@/lib/validation/core';
import { createOpportunitySchema, opportunityStage, opportunityStatus, handoffStatus } from '@/lib/validation/schemas';
import { handleApiError, badRequest } from '@/lib/api/errors';
import { buildSummary } from '@/lib/opportunities/metrics';
import { createManualOpportunity } from '@/lib/opportunities/service';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') || undefined;
  const campaignId = searchParams.get('campaignId') || undefined;
  const ownerId = searchParams.get('ownerId') || undefined;
  const stage = searchParams.get('stage') || undefined;
  const status = searchParams.get('status') || undefined;
  const handoff = searchParams.get('handoffStatus') || undefined;
  const from = searchParams.get('from') || undefined;
  const until = searchParams.get('until') || undefined;
  const search = searchParams.get('search') || undefined;
  const limit = capLimit(searchParams.get('limit'), 100, 500);

  for (const [name, value, check] of [
    ['stage', stage, opportunityStage],
    ['status', status, opportunityStatus],
    ['handoffStatus', handoff, handoffStatus],
  ] as const) {
    if (value && !check.safeParse(value).success) {
      return badRequest(`Invalid ${name} filter`);
    }
  }

  // Role scoping — mirrors canAccessOpportunity: user axis (owner/creator) OR account axis (campaign).
  const scopeConditions: Record<string, unknown>[] = [];
  const visibleUserIds = await getVisibleUserIds(user);
  if (visibleUserIds !== null) {
    scopeConditions.push({
      OR: [{ ownerId: { in: visibleUserIds } }, { createdById: { in: visibleUserIds } }],
    });
  }
  const visibleCampaignIds = await getVisibleCampaignIds(user);
  if (visibleCampaignIds !== null && visibleCampaignIds.length > 0) {
    scopeConditions.push({ campaignId: { in: visibleCampaignIds } });
  }

  const baseWhere: Record<string, unknown> = {
    ...(clientId ? { clientId } : {}),
    ...(campaignId ? { campaignId } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(stage ? { stage: stage as never } : {}),
    ...(status ? { status: status as never } : {}),
    ...(handoff ? { handoffStatus: handoff as never } : {}),
    ...(from || until
      ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(until ? { lte: new Date(until) } : {}) } }
      : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { company: { contains: search, mode: 'insensitive' } },
            { contactName: { contains: search, mode: 'insensitive' } },
            { contactEmail: { contains: search, mode: 'insensitive' } },
            { lead: { is: { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { company: { contains: search, mode: 'insensitive' } }] } } },
          ],
        }
      : {}),
  };

  if (scopeConditions.length > 0) {
    baseWhere.AND = scopeConditions;
  }

  try {
    const [opportunities, summaryRows] = await Promise.all([
      prisma.opportunity.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        where: baseWhere as never,
        include: {
          client: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true, company: true, stage: true } },
          account: { select: { id: true, name: true } },
          contact: { select: { id: true, firstName: true, lastName: true, title: true, email: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          meeting: { select: { id: true, title: true, scheduledAt: true } },
        },
      }),
      prisma.opportunity.findMany({
        where: baseWhere as never,
        select: { stage: true, status: true, value: true, probability: true },
      }),
    ]);

    return NextResponse.json({
      opportunities,
      summary: buildSummary(
        summaryRows.map(r => ({ ...r, value: r.value == null ? null : Number(r.value) })),
      ),
    });
  } catch (err) {
    return handleApiError('GET /api/opportunities', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireManager();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createOpportunitySchema, 'Invalid opportunity');
  if (parsed.error) return parsed.error;

  try {
    const opportunity = await createManualOpportunity({
      user,
      tenantId: user.tenantId!,
      data: parsed.data,
    });
    return NextResponse.json(opportunity, { status: 201 });
  } catch (err) {
    return handleApiError('POST /api/opportunities', err);
  }
}
