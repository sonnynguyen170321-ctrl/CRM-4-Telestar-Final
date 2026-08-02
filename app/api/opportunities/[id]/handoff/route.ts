import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { handoffDecisionSchema } from '@/lib/validation/schemas';
import { handleApiError, forbidden, notFound } from '@/lib/api/errors';
import { canAccessOpportunity, canApproveClientHandoff } from '@/lib/opportunities/access';
import { decideHandoff } from '@/lib/opportunities/lifecycle';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, handoffDecisionSchema, 'Invalid handoff decision');
  if (parsed.error) return parsed.error;

  try {
    const opp = await prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, ownerId: true, createdById: true, campaignId: true, tenantId: true },
    });
    if (!opp) return notFound('Opportunity not found');
    if (!(await canAccessOpportunity(user, opp))) return forbidden();
    if (!canApproveClientHandoff(user)) {
      return forbidden('Only managers can make client handoff decisions');
    }

    const updated = await decideHandoff({
      opportunityId: id,
      user,
      tenantId: opp.tenantId,
      decision: parsed.data.decision,
      clientFeedback: parsed.data.clientFeedback ?? null,
      lostReason: parsed.data.lostReason ?? null,
      lostReasonDetails: parsed.data.lostReasonDetails ?? null,
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError('POST /api/opportunities/[id]/handoff', err);
  }
}
