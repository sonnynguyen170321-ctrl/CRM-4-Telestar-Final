import { prisma } from '@/lib/prisma';
import type { ActivityType, ProspectOperatingState } from '@prisma/client';
import { buildTransitionKey, type TransitionOccurrence } from './keys';

/**
 * The transition primitive (Revenue AI Phase 3).
 *
 * Every operating-state change goes through here, and here owns **all** of the state part of
 * the change: the idempotency ledger row, the `Lead.operatingState` write and the `Activity`.
 * A caller cannot half-apply a transition by forgetting one of them.
 *
 * Callers add only their own consequences — a task, a notification, a work order — and do so
 * *inside* the `onApplied` callback, so those consequences run exactly when the transition is
 * genuinely new. A retry of the same event never reaches them.
 *
 * `Lead.operatingState` is written **only** here. No route, tool or worker updates the column
 * directly.
 */

export interface TransitionResult {
  /** False when this exact occurrence had already been applied. */
  applied: boolean;
  /** The state the lead is in after this call, applied or not. */
  state: ProspectOperatingState;
  /** The ledger row id. Doubles as the episode identifier for a handoff. */
  transitionId: string;
}

export interface ApplyTransitionInput {
  leadId: string;
  tenantId: string;
  occurrence: TransitionOccurrence;
  toState: ProspectOperatingState;
  /** States the lead may be in for this transition to make sense. Empty means any. */
  fromStates?: readonly ProspectOperatingState[];
  activityType: ActivityType;
  activityDescription: string;
  activityMetadata?: Record<string, unknown>;
  /**
   * Required: `Activity.userId` is a non-null FK, so there is no such thing as an
   * actor-less activity in this CRM. For a system-driven transition — an inbound reply — the
   * actor is the lead's assigned SDR, which `Lead.assignedToId` guarantees is present.
   * `systemInitiated` records that no human chose it, rather than faking a null actor.
   */
  actorUserId: string;
  systemInitiated?: boolean;
  workOrderId?: string | null;
  /**
   * Side effects that must happen exactly once, with the ledger row already written. Runs only
   * on a genuinely new transition.
   */
  onApplied?: (result: { transitionId: string }) => Promise<void>;
}

export class TransitionNotAllowedError extends Error {
  constructor(
    readonly leadId: string,
    readonly from: ProspectOperatingState,
    readonly to: ProspectOperatingState
  ) {
    super(`Prospect ${leadId} cannot move from ${from} to ${to}`);
    this.name = 'TransitionNotAllowedError';
  }
}

export async function applyTransition(input: ApplyTransitionInput): Promise<TransitionResult> {
  const transitionKey = buildTransitionKey(input.occurrence);

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, operatingState: true },
  });
  if (!lead) throw new Error(`Prospect ${input.leadId} not found`);

  // Idempotency first. A retry must not re-run the guard either: by the time the first attempt
  // finished, the lead has already moved, so a `fromStates` check would now fail and turn a
  // duplicate delivery into an error instead of a no-op.
  const existing = await prisma.prospectTransition.findUnique({
    where: { tenantId_transitionKey: { tenantId: input.tenantId, transitionKey } },
    select: { id: true, toState: true },
  });
  if (existing) {
    return { applied: false, state: lead.operatingState, transitionId: existing.id };
  }

  if (input.fromStates?.length && !input.fromStates.includes(lead.operatingState)) {
    throw new TransitionNotAllowedError(input.leadId, lead.operatingState, input.toState);
  }

  // The ledger row is written before the state change on purpose: if the process dies between
  // the two, a retry finds the row and reports `applied: false` with the lead still in its old
  // state — visibly inconsistent and repairable. The reverse order would let a retry re-run
  // every side effect against an already-moved lead.
  let transitionId: string;
  try {
    const row = await prisma.prospectTransition.create({
      data: {
        tenantId: input.tenantId,
        leadId: input.leadId,
        kind: input.occurrence.kind,
        transitionKey,
        fromState: lead.operatingState,
        toState: input.toState,
        actorUserId: input.systemInitiated ? null : input.actorUserId,
        workOrderId: input.workOrderId ?? null,
      },
      select: { id: true },
    });
    transitionId = row.id;
  } catch (err) {
    // Two concurrent deliveries of the same event race here. The unique constraint is the
    // arbiter; the loser reports a no-op rather than failing the job.
    if (isUniqueViolation(err)) {
      const winner = await prisma.prospectTransition.findUnique({
        where: { tenantId_transitionKey: { tenantId: input.tenantId, transitionKey } },
        select: { id: true },
      });
      return {
        applied: false,
        state: lead.operatingState,
        transitionId: winner?.id ?? '',
      };
    }
    throw err;
  }

  await prisma.lead.update({
    where: { id: input.leadId },
    data: { operatingState: input.toState, operatingStateAt: new Date() },
  });

  await prisma.activity.create({
    data: {
      userId: input.actorUserId,
      leadId: input.leadId,
      type: input.activityType,
      description: input.activityDescription,
      metadata: {
        ...(input.activityMetadata ?? {}),
        from: lead.operatingState,
        to: input.toState,
        transitionKey,
        ...(input.systemInitiated ? { auto: true } : {}),
      },
    },
  });

  if (input.onApplied) await input.onApplied({ transitionId });

  return { applied: true, state: input.toState, transitionId };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}
