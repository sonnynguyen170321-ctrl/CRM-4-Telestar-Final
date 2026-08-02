import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateOpportunitySchema } from '@/lib/validation/schemas';
import { handleApiError, forbidden, notFound } from '@/lib/api/errors';
import { canAccessOpportunity, canApproveClientHandoff } from '@/lib/opportunities/access';

type RouteContext = { params: Promise<{ id: string }> };

const OPPORTUNITY_INCLUDE = {
  client: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  lead: { select: { id: true, firstName: true, lastName: true, company: true, stage: true } },
  account: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true, title: true, email: true } },
  owner: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  meeting: { select: { id: true, title: true, scheduledAt: true, outcome: true } },
  activities: {
    orderBy: { createdAt: 'desc' as const },
    take: 100,
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  },
};

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;

  try {
    const opp = await prisma.opportunity.findUnique({ where: { id }, include: OPPORTUNITY_INCLUDE });
    if (!opp) return notFound('Opportunity not found');
    if (!(await canAccessOpportunity(user, opp))) return forbidden();

    return NextResponse.json(opp);
  } catch (err) {
    return handleApiError('GET /api/opportunities/[id]', err);
  }
}

// Fields that only manager roles may change directly on the record.
const MANAGER_ONLY_FIELDS = new Set([
  'value',
  'ownerId',
  'stage',
  'status',
  'handoffStatus',
  'lostReason',
  'lostReasonDetails',
  'probability',
  'expectedCloseDate',
  'currency',
]);

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, updateOpportunitySchema, 'Invalid opportunity update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const opp = await prisma.opportunity.findUnique({ where: { id } });
    if (!opp) return notFound('Opportunity not found');
    if (!(await canAccessOpportunity(user, opp))) return forbidden();

    const restricted = Object.keys(body).filter((k) => MANAGER_ONLY_FIELDS.has(k));
    if (restricted.length > 0 && !canApproveClientHandoff(user)) {
      return forbidden('Only managers can change opportunity value, owner, or status fields');
    }

    const updated = await prisma.opportunity.update({
      where: { id },
      data: body as never,
      include: OPPORTUNITY_INCLUDE,
    });

    const activityTypes: string[] = [];
    if (body.stage && body.stage !== opp.stage) activityTypes.push('stage_changed');
    if (body.status && body.status !== opp.status) {
      activityTypes.push(body.status === 'won' ? 'closed_won' : body.status === 'lost' ? 'closed_lost' : 'value_updated');
    }
    if (body.value != null && body.value !== Number(opp.value)) activityTypes.push('value_updated');
    if (body.nextStep && body.nextStep !== opp.nextStep) activityTypes.push('next_step_updated');

    if (activityTypes.length > 0) {
      await prisma.opportunityActivity.create({
        data: {
          tenantId: opp.tenantId,
          opportunityId: id,
          userId: user.id,
          type: activityTypes[0] as never,
          description: 'Opportunity updated',
          metadata: { changes: Object.keys(body) },
        },
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError('PUT /api/opportunities/[id]', err);
  }
}
