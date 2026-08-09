import { prisma } from '@/lib/prisma';
import type { ActivityType, ProspectOperatingState } from '@prisma/client';
import { buildTransitionKey, type TransitionOccurrence } from './keys';

/**
 * The transition primitive (Revenue AI Phase 3).
 *
 * Every operating-state change goes through here, and here owns **all** of the state part of
 * the change: the ledger claim, the `Lead.operatingState` write and the `Activity`. A caller
 * cannot half-apply a transition by forgetting one of them.
 *
 * `Lead.operatingState` is written **only** here. No route, tool or worker updates it directly.
 *
 * ## Ledger-first, but existence is not completion
 *
 * The row is a durable *claim* on one occurrence, not proof that the occurrence finished:
 *
 *   1. insert the claim as `pending`
 *   2. apply the state transition → `state_applied`
 *   3. run each consequence, each claimed individually
 *   4. mark `completed`
 *
 * A retry that finds a non-completed row **resumes** from wherever it stopped rather than
 * reporting a permanent no-op. The earlier design treated the row's existence as success, so a
 * crash between step 1 and step 2 stranded the prospect: every retry said "already applied"
 * while the lead had never moved, and only manual repair could finish it. Manual repair is for
 * genuinely irreconcilable data, not for an ordinary crash window.
 *
 * ## Two guarantees, not one
 *
 *   ProspectTransition lifecycle    resumable and convergent
 *   Individual business effects     at-most-once claimed, with a detectable repair window
 *
 * The transition always converges: whatever the crash, a retry drives it to `completed`.
 *
 * An effect does not. `runEffect` claims before it executes, so a process that dies in between
 * leaves that effect unperformed while the transition still reaches `completed`. **This is not
 * exactly-once.** The window is accepted because it is bounded, detectable and repairable — a
 * `completed` row missing one of its kind's expected effects is the repair case, and
 * ARCHITECTURE §4.2a carries the query. Closing it properly would mean consensus around each
 * side effect, which is a distributed-systems project rather than a CRM state machine.
 *
 * Claim-before-run is the deliberate choice over run-before-record: the latter converges every
 * effect but can duplicate one, and a second "handle this reply" task in an SDR's queue is a
 * worse failure than a missing one that a query can find.
 */

export type TransitionStatus = 'pending' | 'state_applied' | 'completed';

export interface TransitionResult {
  /** True when this call performed work — a first run or a resume that finished one. */
  applied: boolean;
  /** True when the work was picked up from an interrupted earlier attempt. */
  resumed: boolean;
  /** The state the lead is in after this call. */
  state: ProspectOperatingState;
  status: TransitionStatus;
  transitionId: string;
}

/** Claim-then-run helper handed to callers so their consequences are at-most-once. */
export type RunEffect = (effectKey: string, fn: () => Promise<void>) => Promise<void>;

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
   * Required: `Activity.userId` is a non-null FK, so there is no such thing as an actor-less
   * activity in this CRM. For a system-driven transition — an inbound reply — the actor is the
   * lead's assigned SDR, which `Lead.assignedToId` guarantees is present. `systemInitiated`
   * records that no human chose it, rather than faking a null actor.
   */
  actorUserId: string;
  systemInitiated?: boolean;
  workOrderId?: string | null;
  /**
   * Consequences that must happen at most once. Each must be wrapped in `runEffect` with a
   * stable key — an unwrapped write would repeat on every resume.
   */
  onApplied?: (ctx: { transitionId: string; runEffect: RunEffect }) => Promise<void>;
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

const ACTIVITY_EFFECT = 'activity';

export async function applyTransition(input: ApplyTransitionInput): Promise<TransitionResult> {
  const transitionKey = buildTransitionKey(input.occurrence);

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, operatingState: true },
  });
  if (!lead) throw new Error(`Prospect ${input.leadId} not found`);

  const existing = await prisma.prospectTransition.findUnique({
    where: { tenantId_transitionKey: { tenantId: input.tenantId, transitionKey } },
    select: { id: true, status: true, appliedEffects: true },
  });

  if (existing) {
    // Completed is the only status that means "nothing to do".
    if (existing.status === 'completed') {
      return {
        applied: false,
        resumed: false,
        state: lead.operatingState,
        status: 'completed',
        transitionId: existing.id,
      };
    }
    return finish({
      input,
      transitionKey,
      transitionId: existing.id,
      currentStatus: existing.status as TransitionStatus,
      appliedEffects: existing.appliedEffects,
      leadStateBefore: lead.operatingState,
      resumed: true,
    });
  }

  // The guard runs only on a first attempt. A resume must not re-check it: by then the lead has
  // already moved, so the check would now fail and turn recovery into a permanent error.
  if (input.fromStates?.length && !input.fromStates.includes(lead.operatingState)) {
    throw new TransitionNotAllowedError(input.leadId, lead.operatingState, input.toState);
  }

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
        status: 'pending',
      },
      select: { id: true },
    });
    transitionId = row.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;

    // Two concurrent deliveries of the same event. The unique constraint is the arbiter; the
    // loser inspects the winner's row rather than assuming it finished — the winner may still
    // be mid-flight, or may have died between its claim and its state write.
    const winner = await prisma.prospectTransition.findUnique({
      where: { tenantId_transitionKey: { tenantId: input.tenantId, transitionKey } },
      select: { id: true, status: true, appliedEffects: true },
    });
    if (!winner) throw err;

    if (winner.status === 'completed') {
      return {
        applied: false,
        resumed: false,
        state: lead.operatingState,
        status: 'completed',
        transitionId: winner.id,
      };
    }

    // Not finished: converge it. Every step below is individually claimed, so the winner and
    // this caller cannot both perform the same consequence.
    return finish({
      input,
      transitionKey,
      transitionId: winner.id,
      currentStatus: winner.status as TransitionStatus,
      appliedEffects: winner.appliedEffects,
      leadStateBefore: lead.operatingState,
      resumed: true,
    });
  }

  return finish({
    input,
    transitionKey,
    transitionId,
    currentStatus: 'pending',
    appliedEffects: [],
    leadStateBefore: lead.operatingState,
    resumed: false,
  });
}

/**
 * Drive an claimed occurrence to `completed` from wherever it stopped.
 *
 * Every step is guarded so it is safe to enter with any status and any subset of effects
 * already done.
 */
async function finish(args: {
  input: ApplyTransitionInput;
  transitionKey: string;
  transitionId: string;
  currentStatus: TransitionStatus;
  appliedEffects: string[];
  leadStateBefore: ProspectOperatingState;
  resumed: boolean;
}): Promise<TransitionResult> {
  const { input, transitionId } = args;
  const claimed = new Set(args.appliedEffects);

  if (args.currentStatus === 'pending') {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: { operatingState: input.toState, operatingStateAt: new Date() },
    });
    await prisma.prospectTransition.update({
      where: { id: transitionId },
      data: { status: 'state_applied' },
    });
  }

  const runEffect: RunEffect = async (effectKey, fn) => {
    if (claimed.has(effectKey)) return;

    // Claim before running. Two racing resumes cannot both pass this, which is what makes a
    // consequence at-most-once rather than at-least-once.
    const claim = await prisma.prospectTransition.updateMany({
      where: { id: transitionId, NOT: { appliedEffects: { has: effectKey } } },
      data: { appliedEffects: { push: effectKey } },
    });
    if (claim.count !== 1) return;

    claimed.add(effectKey);
    await fn();
  };

  await runEffect(ACTIVITY_EFFECT, async () => {
    await prisma.activity.create({
      data: {
        userId: input.actorUserId,
        leadId: input.leadId,
        type: input.activityType,
        description: input.activityDescription,
        metadata: {
          ...(input.activityMetadata ?? {}),
          from: args.leadStateBefore,
          to: input.toState,
          transitionKey: args.transitionKey,
          ...(input.systemInitiated ? { auto: true } : {}),
        },
      },
    });
  });

  if (input.onApplied) await input.onApplied({ transitionId, runEffect });

  await prisma.prospectTransition.update({
    where: { id: transitionId },
    data: { status: 'completed', completedAt: new Date() },
  });

  return {
    applied: true,
    resumed: args.resumed,
    state: input.toState,
    status: 'completed',
    transitionId,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}
