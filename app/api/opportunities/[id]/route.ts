import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateOpportunitySchema } from '@/lib/validation/schemas';
import { handleApiError, forbidden, notFound, badRequest } from '@/lib/api/errors';
import { canAccessOpportunity, canApproveClientHandoff } from '@/lib/opportunities/access';
import { moveStage } from '@/lib/opportunities/lifecycle';

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

    /**
     * A stage move goes through `moveStage`, never through this update.
     *
     * `lib/opportunities/lifecycle.ts` calls itself the single source of truth for stage moves, and
     * it does five things this route's `data: body` never did: it refuses a move to `lost` with no
     * reason, sets `status` and `closedAt`, reopens a closed deal by clearing them, records the
     * client's acceptance on `handoffStatus`, and syncs the lead plus the contact-intelligence
     * event. Writing `stage: 'won'` here left a deal that read as won on the board while `status`
     * was still `open`, `closedAt` null and `handoffStatus` still `pending`.
     *
     * That last one has already cost something once: the comment in `moveStage` records that
     * acceptance staying `pending` on won deals pinned `clientAcceptanceRate` at 0% while the
     * report showed a six-figure won value. This route is a second door into the same state.
     *
     * No UI calls this route — the board uses `/stage`, `/handoff` and `/activity` — so this closes
     * the bypass rather than changing a path anything currently walks.
     */
    const { stage, status, handoffStatus, lostReason, lostReasonDetails, ...rest } = body as Record<
      string,
      unknown
    >;

    if (status !== undefined && stage === undefined) {
      return forbidden(
        'status is derived from the stage — move the stage via POST /api/opportunities/[id]/stage'
      );
    }
    if (handoffStatus !== undefined) {
      return forbidden(
        'handoffStatus is the client decision — record it via POST /api/opportunities/[id]/handoff'
      );
    }

    // Checked here so the caller gets a 400 rather than the 500 that `moveStage`'s own throw would
    // become. The rule is `moveStage`'s either way; this only states it in HTTP.
    if (stage === 'lost' && !lostReason) {
      return badRequest('lostReason is required when moving an opportunity to lost');
    }

    if (stage !== undefined) {
      await moveStage({
        opportunityId: id,
        user,
        tenantId: opp.tenantId,
        stage: stage as string,
        value: (rest.value as number | undefined) ?? null,
        probability: (rest.probability as number | undefined) ?? null,
        expectedCloseDate: (rest.expectedCloseDate as Date | undefined) ?? null,
        lostReason: (lostReason as string | null | undefined) ?? null,
        lostReasonDetails: (lostReasonDetails as string | null | undefined) ?? null,
      });
    }

    // Whatever is left is an ordinary field edit. `moveStage` has already written value,
    // probability and expectedCloseDate when it ran, and rewriting them here is a harmless no-op
    // with the same values rather than a second source of truth.
    const updated = await prisma.opportunity.update({
      where: { id },
      data: rest as never,
      include: OPPORTUNITY_INCLUDE,
    });

    // Stage and status are deliberately absent from this list now: `moveStage` writes its own
    // `stage_changed` / `closed_won` / `closed_lost` activity with the from/to pair, and logging a
    // second, vaguer 'Opportunity updated' beside it would make the deal's history read as two
    // events where one happened.
    const activityTypes: string[] = [];
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
