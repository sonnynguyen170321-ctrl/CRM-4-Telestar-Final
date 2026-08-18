import { prisma } from '@/lib/prisma';
import { canAccessLead, type SessionUser } from '@/lib/auth';
import { PROSPECT_BLOCKING_STATES } from '@/lib/workorders/conflicts';
import { Prisma } from '@prisma/client';
import {
  applyStepScheduling,
  computeStepDueDateForLead,
  createTaskForStep,
  unenrollLead,
} from './engine';
import { occupancyKeyFor, releaseOccupancy } from './occupancy';
import { enrollmentActivityId, enrollmentStepTaskId } from './identity';
import { checkContactRelationshipGuard } from '@/lib/contact-intelligence/relationshipGuards';

export { enrollmentActivityId, enrollmentStepTaskId } from './identity';

/**
 * Sequence enrollment as a domain service (Phase 8a).
 *
 * The logic lived inside `app/api/sequences/[id]/enroll/route.ts`, which meant the only way to
 * enroll a lead was an HTTP request — and the `outreach_launch` work order needs to enroll from
 * a worker. `ARCHITECTURE.md` §9 says an agent tool calls a domain service and never this app's
 * own API, so the service is where it belongs. The route delegates here; there is one
 * implementation.
 *
 * ## Two stages, because there is no transaction
 *
 * Enrolling and *scheduling the first prospect-facing step* are separate calls:
 *
 * ```text
 * prepareEnrollment    authorization, lifecycle checks, the enrollment row   nothing reaches the prospect
 * finalizeFirstStep    the first task, its scheduling state and its job      the cadence starts
 * ```
 *
 * Neon HTTP has no interactive transactions, so a launch cannot be atomic. Splitting it means a
 * caller with bookkeeping still to do — the AI launch has an operating-state transition to
 * settle — can finish that *before* anything the prospect experiences exists. A crash in between
 * leaves an enrollment nobody is receiving, which the retry converges; the alternative leaves a
 * live cadence attached to a launch reported as failed.
 *
 * Both stages are idempotent, and stage two is *resumable*: it re-applies the scheduling writes
 * even when it finds the task already created, because a Task row alone does not prove the
 * cadence was ever scheduled.
 */

export class SequenceEnrollmentError extends Error {
  constructor(
    readonly code:
      | 'sequence_not_found'
      | 'sequence_inactive'
      | 'sequence_empty'
      | 'lead_not_found'
      | 'forbidden'
      | 'prospect_human_owned'
      | 'lead_already_occupied'
      | 'enrollment_terminal'
      | 'enrollment_paused'
      | 'enrollment_not_owner'
      | 'sequence_designation_changed',
    message: string
  ) {
    super(message);
    this.name = 'SequenceEnrollmentError';
  }
}

export interface EnrollLeadInput {
  leadId: string;
  sequenceId: string;
  /** Provenance when an agent work order drove the enrollment. */
  workOrderId?: string | null;
  /**
   * How this enrollment may treat a cadence that is already running.
   *
   * `human` is a deliberate SDR action and keeps the CRM's switch behaviour: the previous
   * sequence is unenrolled and replaced. `cold_launch` is the agent starting outreach, and it
   * **may not make room for itself** — no unenroll, no pause, no occupancy release. It attempts
   * its own deterministic row and lets the unique occupancy key decide whether it won.
   *
   * That distinction is the whole race. With one shared behaviour, an SDR who enrolled the lead
   * a moment after the agent's eligibility check would have their live cadence closed by the
   * agent before the database ever got to arbitrate.
   */
  mode?: 'human' | 'cold_launch';
  /**
   * A caller-derived primary key for the enrollment.
   *
   * The AI launch passes `launchEnrollmentId(launch.id)`, so the row it intends to create is
   * identifiable **before** it exists. That is what makes a crash immediately after the insert
   * recoverable without a second nullable column recording what the launch "meant" to create.
   */
  enrollmentId?: string;
}

export interface EnrollLeadResult {
  enrollmentId: string;
  leadId: string;
  sequenceId: string;
  sequenceName: string;
  unenrolledFromSequenceId: string | null;
  /** True when an existing active enrollment was reused rather than created. */
  reused: boolean;
  /**
   * Where the reused cadence actually is. A caller must not "finalize step 1" on an enrollment
   * that has moved past it — that would schedule the opening touch again to a prospect already
   * mid-sequence.
   */
  currentStep: number;
}

/**
 * Stage one: everything except the prospect-facing schedule.
 *
 * Guards, in order — each one refuses before anything is written:
 *
 * | Guard | Why |
 * |---|---|
 * | sequence exists, active, has steps | enrolling into an empty sequence schedules nothing |
 * | lead exists, same tenant | tenancy, before any write |
 * | `canAccessLead` | **the** object authorization, the CRM's own, not a copy |
 * | operating state is not human-owned | a person owns this conversation now |
 *
 * The operating-state guard is the one the work order conflict check cannot cover:
 * `detectActivationConflicts` runs at activation, this write happens later, and an approval may
 * have been granted before a handoff. Re-checking here makes "AI cannot enroll a human-managed
 * prospect" a property of the write.
 */
export async function prepareEnrollment(
  user: SessionUser,
  input: EnrollLeadInput
): Promise<EnrollLeadResult> {
  const sequence = await prisma.sequence.findUnique({
    where: { id: input.sequenceId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!sequence) throw new SequenceEnrollmentError('sequence_not_found', 'Sequence not found');
  if (!sequence.isActive) throw new SequenceEnrollmentError('sequence_inactive', 'Sequence is inactive');
  if (sequence.steps.length === 0) {
    throw new SequenceEnrollmentError('sequence_empty', 'Sequence has no steps');
  }

  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw new SequenceEnrollmentError('lead_not_found', 'Lead not found');
  if (lead.tenantId !== sequence.tenantId) {
    throw new SequenceEnrollmentError('forbidden', 'Lead and sequence belong to different tenants');
  }
  if (!(await canAccessLead(user, lead))) {
    throw new SequenceEnrollmentError('forbidden', 'You do not have access to this lead');
  }
  // A paused occurrence of *this* sequence has an explicit resume path. Replacing it would
  // destroy the pause reason and restart the cadence at step one, which is not what "enrol"
  // means when the same sequence is already loaded and merely stopped.
  const pausedSame = await prisma.sequenceEnrollment.findFirst({
    where: {
      tenantId: lead.tenantId,
      leadId: input.leadId,
      sequenceId: input.sequenceId,
      status: 'paused',
    },
    select: { id: true, pausedReason: true },
  });
  if (pausedSame) {
    throw new SequenceEnrollmentError(
      'enrollment_paused',
      `This lead already has a paused enrollment (${pausedSame.id}${pausedSame.pausedReason ? `, reason "${pausedSame.pausedReason}"` : ''}) on this sequence. Resume it instead of enrolling again.`
    );
  }

  if (PROSPECT_BLOCKING_STATES.includes(lead.operatingState)) {
    throw new SequenceEnrollmentError(
      'prospect_human_owned',
      `Prospect is in operating state "${lead.operatingState}" — a human is responsible for this conversation and it may not be enrolled`
    );
  }

  // Commercial Intelligence: Relationship owner protection & cooldown guards
  const relGuard = await checkContactRelationshipGuard({
    leadId: input.leadId,
    user,
    isManagerOverride: user.role === 'director' || user.role === 'floor_manager',
  });
  if (!relGuard.allowed) {
    throw new SequenceEnrollmentError(
      'forbidden',
      relGuard.reason || 'Contact is currently protected from automated sequence outreach.'
    );
  }

  // Idempotent reuse, by identity when the caller supplied one. A retried launch must not
  // restart the cadence at step one.
  const existing = input.enrollmentId
    ? await prisma.sequenceEnrollment.findUnique({ where: { id: input.enrollmentId } })
    : await prisma.sequenceEnrollment.findFirst({
        where: {
          tenantId: lead.tenantId,
          leadId: input.leadId,
          sequenceId: input.sequenceId,
          status: 'active',
        },
      });

  if (existing) {
    return validateAndResumeEnrollment({
      user,
      existing,
      leadId: input.leadId,
      sequenceId: input.sequenceId,
      sequenceName: sequence.name,
      mode: input.mode ?? 'human',
      workOrderId: input.workOrderId ?? null,
    });
  }

  const mode = input.mode ?? 'human';
  let unenrolledFromSequenceId: string | null = null;

  if (mode === 'human' && lead.sequenceId && lead.sequenceId !== input.sequenceId) {
    const previous = await prisma.sequence.findUnique({ where: { id: lead.sequenceId } });
    await unenrollLead(input.leadId, lead.sequenceId);
    await prisma.activity.create({
      data: {
        userId: user.id,
        leadId: input.leadId,
        type: 'sequence_unenrolled',
        description: `Unenrolled from ${previous?.name ?? lead.sequenceId} (switched to ${sequence.name})`,
        metadata: { sequenceId: lead.sequenceId },
      },
    });
    unenrolledFromSequenceId = lead.sequenceId;
  }

  if (mode === 'human') {
    // A deliberate switch closes the incumbent, releasing occupancy in the same statement as the
    // terminal status. `cold_launch` deliberately skips this: an agent that clears the lead
    // first has already won a race the database was supposed to arbitrate.
    await prisma.sequenceEnrollment.updateMany({
      where: { leadId: input.leadId, status: { in: ['active', 'paused'] } },
      data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() },
    });
  }

  // The database is the arbiter, not a prior `findFirst`. Two racers — two work orders, or an
  // agent and an SDR — both reach this insert; the unique `occupancyKey` lets exactly one win.
  let enrollment;
  try {
    enrollment = await prisma.sequenceEnrollment.create({
      data: {
        id: input.enrollmentId,
        leadId: input.leadId,
        sequenceId: input.sequenceId,
        status: 'active',
        currentStep: 1,
        tenantId: lead.tenantId,
        occupancyKey: occupancyKeyFor(lead.tenantId, input.leadId),
      },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;

    // Which uniqueness lost? Our own id means this is a retry of our own insert; the occupancy
    // key means somebody else holds the lead.
    const byId = input.enrollmentId
      ? await prisma.sequenceEnrollment.findUnique({ where: { id: input.enrollmentId } })
      : null;
    if (byId) {
      // The **same** reuse path as the initial lookup. A shortcut here was the crash window:
      // the winner could die between its insert and its bookkeeping, and this caller would
      // report `reused` without repairing anything.
      return validateAndResumeEnrollment({
        user,
        existing: byId,
        leadId: input.leadId,
        sequenceId: input.sequenceId,
        sequenceName: sequence.name,
        mode: input.mode ?? 'human',
        workOrderId: input.workOrderId ?? null,
      });
    }

    const holder = await prisma.sequenceEnrollment.findUnique({
      where: { occupancyKey: occupancyKeyFor(lead.tenantId, input.leadId) },
      select: { id: true, sequenceId: true, status: true },
    });
    throw new SequenceEnrollmentError(
      'lead_already_occupied',
      `Lead is already occupied by enrollment ${holder?.id ?? 'unknown'} (${holder?.status ?? 'unknown'}) on sequence ${holder?.sequenceId ?? 'unknown'}`
    );
  }

  await ensureEnrollmentBookkeeping({
    user,
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    sequenceName: sequence.name,
    enrollmentId: enrollment.id,
    currentStep: 1,
    mode,
    workOrderId: input.workOrderId ?? null,
  });

  return {
    enrollmentId: enrollment.id,
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    sequenceName: sequence.name,
    unenrolledFromSequenceId,
    reused: false,
    currentStep: 1,
  };
}

/**
 * Stage two: the first prospect-facing step, and everything that makes it actually run.
 *
 * **A Task row is not proof of completion.** Creating one is only the first of four writes —
 * the row, `Lead.nextTaskDue`, `SequenceEnrollment.nextActionAt`, and the delayed BullMQ job —
 * and a crash between them leaves a task nothing will execute. Returning early because a Task
 * exists would leave that permanently unrepaired, so this **always re-applies the scheduling**
 * for the step, whether it created the task or found it.
 *
 * Every write is idempotent:
 *
 * | Write | Why re-running is safe |
 * |---|---|
 * | `Task` | created with the caller's deterministic id; a duplicate collides on the primary key and is reused |
 * | `Lead.nextTaskDue` | same computed due date, last write wins |
 * | `SequenceEnrollment.nextActionAt` | same value |
 * | delayed job | `enqueue` dedupes on `(tenantId, jobType, payload)` — same `JobRun`, same BullMQ job id |
 *
 * The due date is recomputed with the same deterministic jitter seed the first attempt used, so
 * a resume schedules the same moment rather than sliding the cadence forward.
 */
/**
 * The one path that reuses an existing deterministic enrollment.
 *
 * Both the initial lookup and the P2002 recovery come through here, so neither can skip a check
 * the other performs: identity, terminality, occupancy ownership, and the bookkeeping repair.
 */
async function validateAndResumeEnrollment(input: {
  user: SessionUser;
  existing: {
    id: string;
    tenantId: string;
    leadId: string;
    sequenceId: string;
    status: string;
    currentStep: number;
    occupancyKey: string | null;
  };
  leadId: string;
  sequenceId: string;
  sequenceName: string;
  mode: 'human' | 'cold_launch';
  workOrderId: string | null;
}): Promise<EnrollLeadResult> {
  const { existing } = input;

  if (
    existing.leadId !== input.leadId ||
    existing.sequenceId !== input.sequenceId
  ) {
    throw new SequenceEnrollmentError(
      'forbidden',
      `Enrollment ${existing.id} does not belong to this lead and sequence`
    );
  }
  // A terminal row is not a retry target. Re-activating it would resurrect a cadence somebody
  // ended; a new occurrence is required instead.
  if (existing.status === 'completed' || existing.status === 'unenrolled') {
    throw new SequenceEnrollmentError(
      'enrollment_terminal',
      `Enrollment ${existing.id} is ${existing.status}; a terminal occurrence cannot be resumed`
    );
  }
  if (existing.occupancyKey !== occupancyKeyFor(existing.tenantId, input.leadId)) {
    throw new SequenceEnrollmentError(
      'lead_already_occupied',
      `Enrollment ${existing.id} no longer holds this lead's occupancy`
    );
  }

  await ensureEnrollmentBookkeeping({
    user: input.user,
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    sequenceName: input.sequenceName,
    enrollmentId: existing.id,
    // The enrollment is the authority on where the cadence is. Writing 1 here would rewind the
    // legacy Lead cache on every retry of an occurrence already at step 2+.
    currentStep: existing.currentStep,
    mode: input.mode,
    workOrderId: input.workOrderId,
  });

  return {
    enrollmentId: existing.id,
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    sequenceName: input.sequenceName,
    unenrolledFromSequenceId: null,
    reused: true,
    currentStep: existing.currentStep,
  };
}


/**
 * Everything that must be true around an enrollment row, applied idempotently.
 *
 * The row existing does not mean the writes around it happened: a crash immediately after the
 * insert leaves the lead's sequence cache unset and no `sequence_enrolled` activity, and a retry
 * that returned early on "the row is here" would never repair either. So this runs for a freshly
 * created enrollment **and** for a rediscovered one.
 *
 * The activity is created under a primary key derived from the enrollment occurrence, so two
 * concurrent recoveries collide in the database rather than both inserting — a `findFirst` →
 * `create` pair is not concurrency control.
 *
 * ## The cold-launch cache guard
 *
 * `Lead.sequenceId` is the *human* designation the planner reads. If an SDR changed it after the
 * agent's enrollment was created, repairing it back would overwrite a newer human decision with
 * a stale agent one. Cold launch therefore refuses instead, and releases its own interrupted
 * enrollment so the lead is not left occupied by a cadence that will never run.
 */
export async function ensureEnrollmentBookkeeping(input: {
  user: SessionUser;
  leadId: string;
  sequenceId: string;
  sequenceName: string;
  enrollmentId: string;
  /** Where the cadence actually is, from the enrollment. Never assumed to be 1. */
  currentStep: number;
  mode: 'human' | 'cold_launch';
  workOrderId: string | null;
}): Promise<void> {
  if (input.mode === 'cold_launch') {
    // The designation is a **write-time** contract, checked against the current row rather than
    // the snapshot this call started from. An SDR who re-designates the lead mid-recovery would
    // otherwise have their choice overwritten by a stale value the agent read minutes earlier.
    //
    // Null is a refusal too: an empty designation is not an invitation for the agent to pick.
    const claimed = await prisma.lead.updateMany({
      where: { id: input.leadId, sequenceId: input.sequenceId },
      data: { sequenceStep: input.currentStep, sequenceStatus: 'active' },
    });

    if (claimed.count !== 1) {
      // Release only this launch's own enrollment, and only while it still occupies the lead.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: input.enrollmentId, status: { in: ['active', 'paused'] } },
        data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() },
      });
      const current = await prisma.lead.findUnique({
        where: { id: input.leadId },
        select: { sequenceId: true },
      });
      throw new SequenceEnrollmentError(
        'sequence_designation_changed',
        `Lead designates ${current?.sequenceId ?? 'no sequence'}, not ${input.sequenceId}; the interrupted launch was released rather than overwriting the newer choice`
      );
    }
  } else {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: {
        sequenceId: input.sequenceId,
        sequenceStep: input.currentStep,
        // Legacy compatibility cache (ARCHITECTURE §4.1). Written because 15 existing files
        // still read it; `SequenceEnrollment` is the authority.
        sequenceStatus: 'active',
      },
    });
  }

  // Stage is read fresh too — a snapshot taken before the insert may already be stale.
  await prisma.lead.updateMany({
    where: { id: input.leadId, stage: 'new' },
    data: { stage: 'sequence_active' },
  });

  try {
    await prisma.activity.create({
      data: {
        id: enrollmentActivityId(input.enrollmentId),
        userId: input.user.id,
        leadId: input.leadId,
        type: 'sequence_enrolled',
        description: `Enrolled in ${input.sequenceName}`,
        metadata: {
          sequenceId: input.sequenceId,
          sequenceName: input.sequenceName,
          enrollmentId: input.enrollmentId,
          ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
        },
      },
    });
  } catch (err) {
    // Already recorded by an earlier attempt or a concurrent recovery. One occurrence, one row.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
  }
}

export function enrollmentFirstTaskId(enrollmentId: string): string {
  return enrollmentStepTaskId(enrollmentId, 1);
}

export interface FinalizeFirstStepInput {
  leadId: string;
  sequenceId: string;
  /** The enrollment occurrence this step belongs to. Its id derives the task's id. */
  enrollmentId: string;
  /** Where the cadence is. Anything past step 1 must not be re-opened. */
  currentStep: number;
  /** Let a scheduling failure propagate instead of being logged. */
  strictScheduling?: boolean;
  /** Called immediately after the task row is created. */
  onTaskCreated?: (taskId: string) => Promise<void>;
}

export interface FinalizeFirstStepResult {
  taskId: string | null;
  created: boolean;
  rescheduled: boolean;
  /** True when the cadence had already moved past step 1 and was left alone. */
  skipped: boolean;
}

export async function finalizeFirstStep(
  input: FinalizeFirstStepInput
): Promise<FinalizeFirstStepResult> {
  // Re-read the exact occurrence. `currentStep` arrived as a snapshot, and lead+sequence
  // correlation is not identity: a human replacement can have taken the lead since, and
  // scheduling against "whichever active enrollment matches" would touch *their* cadence.
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: input.enrollmentId },
  });

  if (
    !enrollment ||
    enrollment.leadId !== input.leadId ||
    enrollment.sequenceId !== input.sequenceId ||
    enrollment.status !== 'active' ||
    enrollment.occupancyKey !== occupancyKeyFor(enrollment.tenantId, input.leadId)
  ) {
    throw new SequenceEnrollmentError(
      'enrollment_not_owner',
      `Enrollment ${input.enrollmentId} is no longer the active occupying enrollment for this lead; refusing to schedule its first step`
    );
  }

  // Past the opening touch: this occurrence's step 1 is done and re-scheduling it would send the
  // prospect the opening email a second time.
  if (enrollment.currentStep > 1) {
    return { taskId: null, created: false, rescheduled: false, skipped: true };
  }

  const sequence = await prisma.sequence.findUnique({
    where: { id: input.sequenceId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!sequence || sequence.steps.length === 0) {
    throw new SequenceEnrollmentError('sequence_empty', 'Sequence has no steps');
  }

  const step = sequence.steps[0];
  const taskId = enrollmentFirstTaskId(input.enrollmentId);

  // Looked up by the occurrence's own id — never by (leadId, sequenceId, stepNumber), which
  // would let a task from a *previous* enrollment of the same sequence answer for this one.
  const existing = await prisma.task.findUnique({ where: { id: taskId } });

  if (existing) {
    // Re-apply the scheduling half. This is the repair for a crash after the row was created:
    // a Task alone does not prove `nextTaskDue`, `nextActionAt` or the delayed job exist.
    const dueDate = await computeStepDueDateForLead(
      input.leadId,
      input.sequenceId,
      step,
      existing.createdAt
    );
    await applyStepScheduling(existing, input.sequenceId, step, dueDate, {
      strict: input.strictScheduling,
      expectedEnrollmentId: input.enrollmentId,
    });
    return { taskId: existing.id, created: false, rescheduled: true, skipped: false };
  }

  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw new SequenceEnrollmentError('lead_not_found', 'Lead not found');

  // Row first, stage second, scheduling third — so `task_created` means the task row exists even
  // when the queue ensure that follows it throws.
  const task = await createTaskForStep(lead, sequence, step, new Date(), {
    taskId,
    deferScheduling: true,
  });
  if (input.onTaskCreated) await input.onTaskCreated(task.id);

  const dueDate = await computeStepDueDateForLead(input.leadId, input.sequenceId, step, task.createdAt);
  await applyStepScheduling(task, input.sequenceId, step, dueDate, {
    strict: input.strictScheduling,
    expectedEnrollmentId: input.enrollmentId,
  });

  return { taskId: task.id, created: true, rescheduled: false, skipped: false };
}

/**
 * Both stages, for callers with no bookkeeping between them — the human-facing API route.
 *
 * The AI launch deliberately does **not** use this: it has an operating-state transition to
 * settle before the cadence may start. See `lib/prospects/outreach.ts`.
 */
export async function enrollLeadInSequence(
  user: SessionUser,
  input: EnrollLeadInput
): Promise<EnrollLeadResult> {
  const result = await prepareEnrollment(user, input);
  await finalizeFirstStep({
    leadId: input.leadId,
    sequenceId: input.sequenceId,
    enrollmentId: result.enrollmentId,
    currentStep: result.currentStep,
  });
  return result;
}
