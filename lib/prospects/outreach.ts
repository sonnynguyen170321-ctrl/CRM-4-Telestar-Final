import { prisma } from '@/lib/prisma';
import { Prisma, type ProspectOperatingState, type SequenceLaunch } from '@prisma/client';
import type { SessionUser } from '@/lib/auth';
import {
  prepareEnrollment,
  finalizeFirstStep,
  type EnrollLeadResult,
} from '@/lib/sequences/enrollment';
import { markProspectAIManaged } from './prospecting';
import {
  materializeApprovedCopy,
  isPersonalizationEnabled,
  type ApprovedStepCopy,
} from '@/lib/sequences/stepCopy';

/**
 * Cold outreach activation (Phase 8a).
 *
 * Its preparation sibling lives under `lib/research/` because drafting depends on `lib/ai`.
 * This half deliberately does not: enrolling a lead and recording that the AI owns the cadence
 * are CRM operations that must keep working when every provider is down.
 *
 * ## The launch gate is a positive allowlist
 *
 * A deny-list is the wrong shape. Blocking the three plainly human-owned states would still let
 * a cold launch out of `waiting_for_prospect` or `reengagement_eligible`, and both are *inside*
 * a human-owned episode that ends only at an explicit `handbackProspectToAI()`. Re-engagement is
 * 8d's work and goes through that handback; `outreach_launch` is not the shortcut around it.
 *
 * ```text
 * ready_for_outreach ──launchAIOutreach──▶ ai_managed
 * ```
 *
 * ## A resume is proven, never inferred
 *
 * "There is an active enrollment on this lead for this sequence" proves nothing about who made
 * it: the authenticated `POST /api/sequences/[id]/enroll` route calls the same domain service.
 * An SDR enrolling the lead between activation and execution would otherwise be adopted by the
 * agent as its own interrupted attempt, and the prospect would silently become `ai_managed`.
 *
 * So resume requires a `SequenceLaunch` row for **this work order** whose `enrollmentId` is the
 * active enrollment. Same lead, same sequence, same state and same timing are correlations; the
 * row is provenance.
 *
 * ## Every stage is idempotent, so a crash converges
 *
 * ```text
 * claimed → enrolled → state_applied → task_created → completed
 * ```
 *
 * The launch row is unique per work order, the enrollment is reused, the transition is
 * ledger-inert, the first task carries a deterministic primary key derived from the launch, and
 * `enqueue` dedupes on its payload. A retry re-runs the remaining stages; nothing duplicates.
 */

/** The only operating state a cold outreach launch may start from. */
export const COLD_LAUNCH_STATES: readonly ProspectOperatingState[] = ['ready_for_outreach'];

/** States an interrupted launch may be resumed from — the two it could have left behind. */
export const LAUNCH_RESUME_STATES: readonly ProspectOperatingState[] = [
  'ready_for_outreach',
  'ai_managed',
];

/** Enrollment statuses that mean a cadence already exists for this lead. */
const OCCUPYING_ENROLLMENT_STATUSES = ['active', 'paused'] as const;

export type LaunchStage = 'claimed' | 'enrolled' | 'state_applied' | 'task_created' | 'completed';

export type LaunchRefusalReason =
  | 'lead_not_found'
  | 'operating_state_not_launchable'
  | 'active_enrollment_exists'
  | 'paused_enrollment_exists'
  | 'enrollment_not_owned_by_work_order';

export class LaunchNotAllowedError extends Error {
  constructor(
    readonly reason: LaunchRefusalReason,
    message: string
  ) {
    super(message);
    this.name = 'LaunchNotAllowedError';
  }
}

export interface LaunchOutreachInput {
  leadId: string;
  sequenceId: string;
  workOrderId: string;
  /**
   * Approved, prospect-facing copy for this cadence — plain strings the approval already
   * resolved, never a request to generate any.
   *
   * Written between the enrollment and the first task, so by the time anything is executable the
   * content is durable. Omit it and every step falls back to its shared template, which is what
   * every cadence did before personalization existed.
   */
  approvedCopy?: ApprovedStepCopy[];
  /**
   * Optional cross-check only. Tenant and actor come from the authenticated session; a value
   * that disagrees is a refusal rather than an override.
   */
  tenantId?: string;
  actorUserId?: string;
}

export interface LaunchOutreachResult {
  enrollment: EnrollLeadResult;
  state: string;
  /** True when this call converged an earlier interrupted launch instead of starting one. */
  resumed: boolean;
  /** Null when the cadence had already moved past step 1. */
  taskId: string | null;
  stage: LaunchStage;
}

export type LaunchEligibility =
  | { mode: 'launch' }
  | { mode: 'resume'; launch: SequenceLaunch }
  | { mode: 'refused'; reason: LaunchRefusalReason; detail: string };

/**
 * Decide whether this work order may start a cold cadence, or is resuming its own.
 *
 * Exported so the planner and the launch share one rule rather than two that drift, and it
 * takes `workOrderId` because ownership cannot be answered without it.
 */
export async function assessLaunchEligibility(input: {
  tenantId: string;
  leadId: string;
  sequenceId: string;
  workOrderId: string;
}): Promise<LaunchEligibility> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { tenantId: true, operatingState: true },
  });
  if (!lead || lead.tenantId !== input.tenantId) {
    return { mode: 'refused', reason: 'lead_not_found', detail: 'lead not found in this tenant' };
  }

  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: {
      tenantId: input.tenantId,
      leadId: input.leadId,
      status: { in: [...OCCUPYING_ENROLLMENT_STATUSES] },
    },
    select: { id: true, sequenceId: true, status: true, pausedReason: true },
  });

  const launch = await prisma.sequenceLaunch.findUnique({
    where: { tenantId_workOrderId: { tenantId: input.tenantId, workOrderId: input.workOrderId } },
  });

  const active = enrollments.find((e) => e.status === 'active');
  const paused = enrollments.find((e) => e.status === 'paused');

  if (active) {
    // Ownership is the only thing that turns an existing cadence into a resume.
    // Ownership is identity, not correlation: the active enrollment must be *the* row this
    // launch's id derives. `SequenceLaunch.enrollmentId` is not consulted, so a crash before it
    // was written still resumes.
    const ownedByThisLaunch =
      !!launch &&
      launch.sequenceId === input.sequenceId &&
      launch.leadId === input.leadId &&
      active.id === launchEnrollmentId(launch.id);

    if (!ownedByThisLaunch) {
      return {
        mode: 'refused',
        reason: launch ? 'enrollment_not_owned_by_work_order' : 'active_enrollment_exists',
        detail: launch
          ? `lead is actively enrolled in sequence ${active.sequenceId} under enrollment ${active.id}, which this work order's launch did not create`
          : `lead is already actively enrolled in sequence ${active.sequenceId}`,
      };
    }

    if (!LAUNCH_RESUME_STATES.includes(lead.operatingState)) {
      return {
        mode: 'refused',
        reason: 'operating_state_not_launchable',
        detail: `prospect is "${lead.operatingState}"; an interrupted launch may only resume while the prospect is ${LAUNCH_RESUME_STATES.join(' or ')}`,
      };
    }

    return { mode: 'resume', launch };
  }

  if (paused) {
    return {
      mode: 'refused',
      reason: 'paused_enrollment_exists',
      detail: `lead has a paused enrollment (${paused.id}${paused.pausedReason ? `, reason "${paused.pausedReason}"` : ''}); it must resume through the sequence lifecycle, not be replaced`,
    };
  }

  if (!COLD_LAUNCH_STATES.includes(lead.operatingState)) {
    return {
      mode: 'refused',
      reason: 'operating_state_not_launchable',
      detail: `prospect is "${lead.operatingState}"; a cold outreach launch may only start from ${COLD_LAUNCH_STATES.join(', ')}`,
    };
  }

  return { mode: 'launch' };
}

/**
 * Activate approved outreach, in durable stages that fail closed.
 *
 * ```text
 * 1. eligibility            no side effect
 * 2. claim the launch row   unique per work order — this is also the provenance record
 * 3. prepareEnrollment      the enrollment row; nothing the prospect experiences
 * 4. markProspectAIManaged  the state transition, ledger-idempotent
 * 5. finalizeFirstStep      the task, its scheduling state and its delayed job
 * ```
 *
 * The order is the point: every step that can fail and make the launch report failure happens
 * before step 5, so a crash never leaves a live cadence attached to a launch recorded as
 * unsuccessful. A retry re-enters at step 1 and converges — and because stage 5 is itself
 * resumable, a crash *inside* it is repaired too rather than being mistaken for completion.
 */
export async function launchAIOutreach(
  user: SessionUser,
  input: LaunchOutreachInput
): Promise<LaunchOutreachResult> {
  const tenantId = user.tenantId;
  if (!tenantId) throw new Error('launchAIOutreach refused: the session has no tenant context.');
  if (input.tenantId && input.tenantId !== tenantId) {
    throw new Error(
      `launchAIOutreach refused: requested tenant ${input.tenantId} is not the session tenant.`
    );
  }
  if (input.actorUserId && input.actorUserId !== user.id) {
    throw new Error('launchAIOutreach refused: requested actor is not the authenticated user.');
  }

  const eligibility = await assessLaunchEligibility({
    tenantId,
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    workOrderId: input.workOrderId,
  });
  if (eligibility.mode === 'refused') {
    throw new LaunchNotAllowedError(eligibility.reason, `Outreach launch refused — ${eligibility.detail}`);
  }

  const launch = await claimLaunch({
    tenantId,
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    workOrderId: input.workOrderId,
  });

  const enrollment = await prepareEnrollment(user, {
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    workOrderId: input.workOrderId,
    // Derived from the launch, so the row this call intends to create is identifiable before it
    // exists — a crash immediately after the insert is recoverable without a second column.
    enrollmentId: launchEnrollmentId(launch.id),
    // The agent never clears an incumbent cadence to make room for itself.
    mode: 'cold_launch',
  });

  await advanceLaunch(launch.id, 'enrolled', { enrollmentId: enrollment.enrollmentId });

  // Approved copy lands here on purpose: after the enrollment exists, and before
  // `finalizeFirstStep` creates the task and its delayed job. Anything executable therefore has
  // its prospect-facing content already durable, and a crash between the two leaves copy with no
  // cadence rather than a cadence with no copy.
  //
  // Idempotent, so the resume path re-runs it harmlessly.
  if (input.approvedCopy?.length && isPersonalizationEnabled()) {
    await materializeApprovedCopy({
      enrollmentId: enrollment.enrollmentId,
      tenantId,
      steps: input.approvedCopy,
      approvedById: user.id,
    });
  }

  // Between the enrollment and the state change, a human may have replaced the cadence. Marking
  // the prospect AI-managed on a cadence the agent no longer owns is the write this guards.
  const stillOwned = await prisma.sequenceEnrollment.findUnique({
    where: { id: enrollment.enrollmentId },
    select: { status: true, sequenceId: true, occupancyKey: true },
  });
  const designation = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { sequenceId: true },
  });
  if (
    !stillOwned ||
    stillOwned.status !== 'active' ||
    stillOwned.sequenceId !== input.sequenceId ||
    designation?.sequenceId !== input.sequenceId
  ) {
    throw new LaunchNotAllowedError(
      'enrollment_not_owned_by_work_order',
      `Outreach launch refused — this launch no longer owns the lead's cadence`
    );
  }

  const transition = await markProspectAIManaged({
    leadId: input.leadId,
    tenantId,
    workOrderId: input.workOrderId,
    actorUserId: user.id,
    // The guard is on the write, not a preceding read: if the SDR re-designates the lead between
    // the check above and this statement, zero rows update and the transition refuses.
    stateGuard: { sequenceId: input.sequenceId },
  });

  await advanceLaunch(launch.id, 'state_applied');

  // The first task's identity comes from the **enrollment occurrence**, the same rule the human
  // path uses. AI provenance is preserved anyway, because the enrollment id is itself derived
  // from the launch: SequenceLaunch.id → enrollment id → task id.
  const finalized = await finalizeFirstStep({
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    enrollmentId: enrollment.enrollmentId,
    currentStep: enrollment.currentStep,
    // The launch's own completion depends on the delayed job existing.
    strictScheduling: true,
    onTaskCreated: (taskId) => advanceLaunch(launch.id, 'task_created', { taskId }),
  });

  // Only now — the delayed job exists, or `finalizeFirstStep` threw and this line was never
  // reached, leaving the launch resumable.
  await advanceLaunch(launch.id, 'completed', { taskId: finalized.taskId ?? undefined });

  return {
    enrollment,
    state: transition.state,
    resumed: eligibility.mode === 'resume',
    taskId: finalized.taskId,
    stage: 'completed',
  };
}

/**
 * The enrollment a given launch intends to create.
 *
 * Derived rather than stored: `SequenceLaunch.id` already is the durable identity, so a crash
 * between the launch row and the enrollment insert needs no extra nullable column to recover
 * from. `SequenceLaunch.enrollmentId` remains as an audit field and is never required to resume.
 */
export function launchEnrollmentId(launchId: string): string {
  return `seqlaunch-${launchId}-enrollment`;
}

/**
 * Create the launch row, or return the existing one for this work order.
 *
 * The unique constraint is the concurrency control: two callers racing produce one row, and the
 * loser reads the winner's rather than proceeding with its own idea of the launch.
 */
async function claimLaunch(input: {
  tenantId: string;
  leadId: string;
  sequenceId: string;
  workOrderId: string;
}): Promise<SequenceLaunch> {
  try {
    return await prisma.sequenceLaunch.create({
      data: {
        tenantId: input.tenantId,
        leadId: input.leadId,
        sequenceId: input.sequenceId,
        workOrderId: input.workOrderId,
        stage: 'claimed',
      },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    return prisma.sequenceLaunch.findUniqueOrThrow({
      where: { tenantId_workOrderId: { tenantId: input.tenantId, workOrderId: input.workOrderId } },
    });
  }
}

const STAGE_ORDER: LaunchStage[] = ['claimed', 'enrolled', 'state_applied', 'task_created', 'completed'];

/** Move the launch forward. Never backwards: a resume re-runs work already recorded as done. */
async function advanceLaunch(
  launchId: string,
  stage: LaunchStage,
  data: { enrollmentId?: string; taskId?: string } = {}
): Promise<void> {
  const current = await prisma.sequenceLaunch.findUnique({ where: { id: launchId } });
  if (!current) return;

  const currentIndex = STAGE_ORDER.indexOf(current.stage as LaunchStage);
  const nextIndex = STAGE_ORDER.indexOf(stage);

  await prisma.sequenceLaunch.update({
    where: { id: launchId },
    data: {
      ...(nextIndex > currentIndex ? { stage } : {}),
      ...(data.enrollmentId ? { enrollmentId: data.enrollmentId } : {}),
      ...(data.taskId ? { taskId: data.taskId } : {}),
    },
  });
}
