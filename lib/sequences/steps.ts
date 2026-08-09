import { prisma } from '@/lib/prisma';
import type { Channel } from '@prisma/client';

/**
 * Step reconciliation for the sequence builder.
 *
 * The builder used to save by deleting every step and re-creating it. That broke two
 * things at once:
 *
 *   1. It deletes steps out from under active enrollments, which the runtime law
 *      forbids — an enrollment sitting on step 3 loses the row its currentStep refers to.
 *   2. Step ids are the seed for deterministic send-time jitter and A/B variant choice
 *      (spec §10, §42). New ids on every save re-roll both for every in-flight lead, so
 *      editing a step's instructions would silently reschedule and re-bucket everyone.
 *
 * Reconciling by `order` keeps the identity of a step that still exists, so a save is
 * only as disruptive as the edit actually was.
 */

export interface IncomingStep {
  order?: number;
  channel: Channel;
  delayDays?: number;
  delayHours?: number;
  templateId?: string | null;
  instructions?: string | null;
  autoComplete?: boolean;
  sendWindowStartMinutes?: number | null;
  sendWindowEndMinutes?: number | null;
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  /** Orders that could not be removed because an active enrollment still sits on them. */
  blockedOrders: number[];
}

/** Fields a step carries regardless of whether it is being created or updated. */
function stepFields(step: IncomingStep, order: number) {
  return {
    order,
    channel: step.channel,
    delayDays: step.delayDays ?? 1,
    delayHours: step.delayHours ?? 0,
    templateId: step.templateId ?? null,
    instructions: step.instructions ?? null,
    autoComplete: step.autoComplete ?? false,
    sendWindowStartMinutes: step.sendWindowStartMinutes ?? null,
    sendWindowEndMinutes: step.sendWindowEndMinutes ?? null,
  };
}

/**
 * Apply the incoming step list to a sequence, preserving the ids of steps that survive.
 *
 * Removals are refused — not silently skipped — when an active enrollment still points at
 * the step. The caller turns `blockedOrders` into a 409 so the manager finds out rather
 * than believing the edit landed.
 *
 * No `$transaction`: the Neon HTTP driver has no interactive transactions. The order below
 * (update, create, delete) is chosen so a failure part-way leaves the sequence with too
 * many steps rather than too few — an extra trailing step is inert until an enrollment
 * reaches it, whereas a missing one strands the enrollments already there.
 */
export async function reconcileSequenceSteps(
  sequenceId: string,
  tenantId: string,
  incoming: IncomingStep[],
): Promise<ReconcileResult> {
  const existing = await prisma.sequenceStep.findMany({
    where: { sequenceId },
    orderBy: { order: 'asc' },
  });
  const byOrder = new Map(existing.map((s) => [s.order, s]));

  const result: ReconcileResult = { created: 0, updated: 0, deleted: 0, blockedOrders: [] };

  for (const [idx, step] of incoming.entries()) {
    const order = step.order ?? idx + 1;
    const current = byOrder.get(order);

    if (current) {
      await prisma.sequenceStep.update({
        where: { id: current.id },
        data: stepFields(step, order),
      });
      result.updated++;
    } else {
      await prisma.sequenceStep.create({
        data: { ...stepFields(step, order), sequenceId, tenantId },
      });
      result.created++;
    }
  }

  const keptOrders = new Set(incoming.map((s, idx) => s.order ?? idx + 1));
  const removable = existing.filter((s) => !keptOrders.has(s.order));

  for (const step of removable) {
    const activeOnStep = await prisma.sequenceEnrollment.count({
      where: { sequenceId, status: 'active', currentStep: step.order },
    });

    if (activeOnStep > 0) {
      result.blockedOrders.push(step.order);
      continue;
    }

    await prisma.sequenceStep.delete({ where: { id: step.id } });
    result.deleted++;
  }

  return result;
}
