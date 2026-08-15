import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead, canReferenceCampaign } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { createWorkOrder, WorkOrderValidationError } from '@/lib/workorders/service';
import { ALL_WORK_ORDER_TYPES, BUDGET_FIELDS } from '@/lib/workorders/types';

/**
 * Typed work orders (Revenue AI Phase 6b).
 *
 * Services only — there is no work order UI in this phase, and these exist so the domain is
 * reachable and testable end to end rather than to back a screen.
 *
 * Every mutation delegates to `lib/workorders/service.ts`. The route validates shape and proves
 * identity; conflicts, budget bounds, tenancy and lifecycle rules are the domain's, so a second
 * caller cannot reach the model by a path with different rules.
 */

const createSchema = z.object({
  type: z.enum(ALL_WORK_ORDER_TYPES as unknown as [string, ...string[]]),
  requestKey: z.string().min(1).max(200),
  leadId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  budgets: z
    .object({
      researchBudget: z.number().int().optional(),
      tokenBudget: z.number().int().optional(),
      maxToolCalls: z.number().int().optional(),
      maxExecutionDuration: z.number().int().optional(),
    })
    .strict()
    .optional(),
});

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const status = req.nextUrl.searchParams.get('status');
    const orders = await prisma.workOrder.findMany({
      where: { tenantId: user.tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({ workOrders: orders });
  } catch (err) {
    return handleApiError('work-orders', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Object authorization for the *request* boundary. `createWorkOrder` deliberately keeps only
    // tenancy (`resolveScope`), because internal callers — `handbackProspectToAI`, the agent
    // runtime — reach it having already run their own authorization, and adding a session-shaped
    // check inside the domain service would either duplicate theirs or block them.
    //
    // What this closes is an existence oracle. A real-but-hidden lead answered 201 while a
    // nonexistent one answered 422, so the status code told a caller whether a guessed id exists.
    // `canAccessLead` is the same authority dispatch uses, applied one boundary earlier; the
    // refusal is deliberately shaped like the not-found one so the oracle does not survive it.
    if (parsed.data.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: parsed.data.leadId, tenantId: user.tenantId },
        select: { assignedToId: true, campaignId: true },
      });
      if (!lead || !(await canAccessLead(user, lead))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    if (parsed.data.campaignId) {
      const campaignCheck = await canReferenceCampaign(user, parsed.data.campaignId);
      if (campaignCheck !== 'ok') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const order = await createWorkOrder({
      tenantId: user.tenantId,
      type: parsed.data.type,
      createdById: user.id,
      requestKey: parsed.data.requestKey,
      leadId: parsed.data.leadId ?? null,
      campaignId: parsed.data.campaignId ?? null,
      budgets: parsed.data.budgets,
    });

    return NextResponse.json({ workOrder: order }, { status: 201 });
  } catch (err) {
    if (err instanceof WorkOrderValidationError) {
      // 422 rather than 400: the request was well-formed, and the domain rejected its content.
      // The violations name every out-of-bounds budget at once, per `BUDGET_FIELDS`.
      return NextResponse.json(
        { error: err.message, violations: err.violations, fields: BUDGET_FIELDS },
        { status: 422 }
      );
    }
    return handleApiError('work-orders', err);
  }
}
