import { prisma } from '@/lib/prisma';
import type { ProspectOperatingState } from '@prisma/client';
import { isProspectTouching, OCCUPYING_STATUSES, type WorkOrderType } from './types';

/**
 * Work order conflict detection (Revenue AI Phase 6a).
 *
 * One lead must not sit under two competing work orders. "Competing" is not "any two" — an
 * assistance order that summarises a thread while an outreach order runs is the agent being
 * useful, and blocking it would make `human_managed` mean "AI off", which ARCHITECTURE §4.3
 * says it does not. Competition is specifically **both orders able to reach the prospect**.
 *
 * Four independent sources are checked, and each is reported by name:
 *
 * | Source | Question it answers |
 * |---|---|
 * | `active_work_order` | is another order *intending* to work this lead? |
 * | `active_lease` | is another order *currently executing* against it? |
 * | `active_sequence_enrollment` | is the authoritative cadence already running? |
 * | `operating_state` | is a human responsible for this prospect right now? |
 *
 * Intent and execution are separate rows because they diverge: a paused order still occupies
 * the lead but has released its lease, and a lease can outlive a crashed order whose status
 * never got written. Collapsing them into one check would miss whichever half was stale.
 *
 * **Nothing here cancels or replaces anything.** A conflict is a refusal that names what it
 * collided with, and the caller decides. Silently superseding live work is how an SDR's
 * in-flight sequence disappears with no record of who ended it.
 */

export type WorkOrderConflictKind =
  | 'active_work_order'
  | 'active_lease'
  | 'active_sequence_enrollment'
  | 'operating_state';

export interface WorkOrderConflict {
  kind: WorkOrderConflictKind;
  /** Names the specific thing collided with, in words a person can act on. */
  detail: string;
  /** Id of the conflicting row, when the conflict is a row. */
  conflictingId?: string;
}

/**
 * Operating states in which no agent may reach the prospect.
 *
 * `human_managed` and `human_attention` are both "a person owns this conversation now".
 * `completed` is "this prospect is done" — restarting outreach against a closed prospect is
 * the failure that makes a CRM untrustworthy to the client whose list it is.
 *
 * Assistance work is unaffected: these block prospect-touching types only.
 */
export const PROSPECT_BLOCKING_STATES: readonly ProspectOperatingState[] = [
  'human_attention',
  'human_managed',
  'completed',
];

export interface ConflictCheckInput {
  tenantId: string;
  /** Batch orders have no lead and therefore no lead-level conflicts. */
  leadId: string | null;
  type: WorkOrderType;
  /** The order being activated, excluded from its own conflict check. */
  workOrderId?: string;
  /** Injected in tests; defaults to now. */
  now?: Date;
}

/**
 * Every conflict that would block activation, not just the first.
 *
 * All of them, because a caller told "there is an active sequence" fixes that, retries, and is
 * then told about the lease. Two round trips to learn two facts the first query already had.
 */
export async function detectActivationConflicts(
  input: ConflictCheckInput
): Promise<WorkOrderConflict[]> {
  if (!input.leadId) return [];

  const now = input.now ?? new Date();
  const wantsProspect = isProspectTouching(input.type);
  const conflicts: WorkOrderConflict[] = [];

  const occupying = await prisma.workOrder.findMany({
    where: {
      tenantId: input.tenantId,
      leadId: input.leadId,
      status: { in: [...OCCUPYING_STATUSES] },
      ...(input.workOrderId ? { id: { not: input.workOrderId } } : {}),
    },
    select: { id: true, type: true, status: true },
  });

  for (const other of occupying) {
    // Two orders compete only when both can reach the prospect. An assistance order alongside
    // an outreach order is the normal, useful case.
    if (!wantsProspect || !isProspectTouching(other.type as WorkOrderType)) continue;
    conflicts.push({
      kind: 'active_work_order',
      conflictingId: other.id,
      detail: `work order ${other.id} of type "${other.type}" is ${other.status} on this lead and can also reach the prospect`,
    });
  }

  if (wantsProspect) {
    const lease = await prisma.workOrderLease.findUnique({
      where: { tenantId_leadId: { tenantId: input.tenantId, leadId: input.leadId } },
      select: { id: true, workOrderId: true, expiresAt: true, releasedAt: true },
    });

    // A released or expired lease is not a conflict — expiry is the recovery path, and treating
    // a dead holder's row as live is how a crashed worker strands a lead permanently.
    const leaseIsLive =
      lease && !lease.releasedAt && lease.expiresAt > now && lease.workOrderId !== input.workOrderId;

    if (lease && leaseIsLive) {
      conflicts.push({
        kind: 'active_lease',
        conflictingId: lease.id,
        detail: `lead is leased by work order ${lease.workOrderId} until ${lease.expiresAt.toISOString()}`,
      });
    }

    // The authoritative execution state, per ARCHITECTURE §4.1. Deliberately not
    // `Lead.sequenceStatus`, which is a legacy compatibility cache with nothing keeping it
    // honest — this is new logic, so it branches on the enrollment.
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { tenantId: input.tenantId, leadId: input.leadId, status: 'active' },
      select: { id: true, sequenceId: true, currentStep: true },
    });

    if (enrollment) {
      conflicts.push({
        kind: 'active_sequence_enrollment',
        conflictingId: enrollment.id,
        detail: `lead is actively enrolled in sequence ${enrollment.sequenceId} at step ${enrollment.currentStep}`,
      });
    }

    const lead = await prisma.lead.findUnique({
      where: { id: input.leadId },
      select: { operatingState: true },
    });

    if (lead && PROSPECT_BLOCKING_STATES.includes(lead.operatingState)) {
      conflicts.push({
        kind: 'operating_state',
        detail: `prospect is in operating state "${lead.operatingState}"; a "${input.type}" work order can reach the prospect and may not run while a human is responsible`,
      });
    }
  }

  return conflicts;
}

export class WorkOrderConflictError extends Error {
  readonly code = 'work_order_conflict';

  constructor(readonly conflicts: readonly WorkOrderConflict[]) {
    super(`Work order refused — ${describeConflicts(conflicts)}`);
    this.name = 'WorkOrderConflictError';
  }
}

/** One sentence naming every conflict, for the refusal message and the log line. */
export function describeConflicts(conflicts: readonly WorkOrderConflict[]): string {
  if (conflicts.length === 0) return 'no conflict';
  return conflicts.map((conflict) => `${conflict.kind}: ${conflict.detail}`).join('; ');
}
