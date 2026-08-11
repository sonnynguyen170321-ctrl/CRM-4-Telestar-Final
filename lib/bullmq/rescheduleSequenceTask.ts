import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { JobType } from './types';
import { DEFAULT_JOB_OPTIONS, JOB_OPTIONS } from './jobOptions';
import { sequenceQueue } from './queues';
import { buildJobDedupeKey, ensureJob } from './ensureJob';

/**
 * "Ensure this task has exactly one effective future schedule" (Phase 8a).
 *
 * ## Why a resume cannot just enqueue
 *
 * Pausing a cadence skips its task but leaves the *original delayed BullMQ job* in the queue.
 * Adding a second job on resume therefore produces two runnable executions:
 *
 * ```text
 * resume computes a new due time T2
 * the original delayed job still fires at T1   (T1 < T2)
 * → the prospect is contacted before the resumed schedule
 * ```
 *
 * The second job later finding the task completed does not undo that — the cadence already ran at
 * the wrong time. So a resume has to *reason about the job that already exists* rather than add
 * one beside it.
 *
 * | State of the original | What happens |
 * |---|---|
 * | delayed | its delay is changed to the new target — same `JobRun`, same job id, same payload |
 * | waiting / prioritized | removed and re-added at the target under the same id |
 * | active | refused: `execution_in_flight`. Never a concurrent execution alongside a running one |
 * | `JobRun` running | same refusal, for the same reason |
 * | queued but the job is gone | re-added under the same id |
 * | settled (completed / failed) | one fresh job under a *stable* resume identity |
 * | nothing at all | created |
 *
 * The fresh-job identity is derived from the target due time, not the clock, so retrying the same
 * resume converges on the same job instead of stacking one per attempt. It goes through
 * `ensureJob` — never `enqueue`/`enqueueReschedule` — because those upsert the durable mirror back
 * to `queued`, which would rewrite a truthful running/completed/failed record.
 */

export type RescheduleOutcome =
  /** The existing delayed job was moved to the new target. */
  | 'moved'
  /** A waiting/prioritized job was removed and re-added at the target under the same id. */
  | 'replaced'
  /** The mirror said queued and the queue had lost the job. */
  | 'repaired'
  /** The original had settled; one fresh job now exists under the resume identity. */
  | 'fresh'
  /** Nothing existed for this payload. */
  | 'created'
  /** The intended schedule is already in place; nothing was added. */
  | 'already_scheduled';

export interface RescheduleResult {
  ok: boolean;
  outcome?: RescheduleOutcome;
  /** Retryable: an execution of this exact payload is in flight. */
  refusal?: 'execution_in_flight';
  jobId?: string;
  detail?: string;
}

export interface RescheduleSequenceTaskInput {
  taskId: string;
  expectedEnrollmentId?: string;
  targetDueAt: Date;
  tenantId: string;
}

/** `JobRun` statuses that mean an execution is under way — never schedule beside one. */
const IN_FLIGHT = new Set(['running', 'active']);
/** `JobRun` statuses that mean the original can no longer be revived. */
const SETTLED = new Set(['completed', 'failed']);

/** Stable identity for the replacement job: derived from the target, never from the clock. */
function resumeDedupeKey(baseKey: string, targetDueAt: Date): string {
  return crypto
    .createHash('sha256')
    .update(`${baseKey}:resume:${targetDueAt.toISOString()}`)
    .digest('hex');
}

export async function rescheduleSequenceTask(
  input: RescheduleSequenceTaskInput
): Promise<RescheduleResult> {
  const payload = {
    taskId: input.taskId,
    expectedEnrollmentId: input.expectedEnrollmentId,
  };
  const delay = Math.max(0, input.targetDueAt.getTime() - Date.now());
  const queue = sequenceQueue();
  const baseKey = buildJobDedupeKey(
    input.tenantId,
    JobType.SEQUENCE_EXECUTE_TASK,
    payload as unknown as Record<string, unknown>
  );

  const original = await tenantStorage.run({ tenantId: input.tenantId, bypassRls: true }, () =>
    prisma.jobRun.findUnique({ where: { dedupeKey: baseKey } })
  );

  if (!original) {
    const created = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, payload, {
      tenantId: input.tenantId,
      delay,
    });
    return { ok: true, outcome: created.outcome === 'created' ? 'created' : 'already_scheduled', jobId: created.jobId };
  }

  if (IN_FLIGHT.has(original.status)) {
    return {
      ok: false,
      refusal: 'execution_in_flight',
      detail: `Job ${original.id} for task ${input.taskId} is executing; retry once it settles.`,
    };
  }

  if (!SETTLED.has(original.status)) {
    const moved = await moveExistingJob(queue, original.id, payload, delay);
    if (moved) return moved;
    // Fell through: the queue says the original already ran. Treat it as settled.
  }

  // A settled original cannot be revived — `ensureJob` deliberately refuses to rewrite it. This is
  // the one case that legitimately needs a new durable job, under an identity derived from the
  // target so repeats converge.
  const fresh = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, payload, {
    tenantId: input.tenantId,
    delay,
    dedupeKey: resumeDedupeKey(baseKey, input.targetDueAt),
  });
  return {
    ok: true,
    outcome: fresh.outcome === 'created' ? 'fresh' : 'already_scheduled',
    jobId: fresh.jobId,
  };
}

/**
 * Move the job that already exists, or report that it cannot be moved.
 *
 * Returns null when the queue has no live job to move, so the caller falls through to issuing a
 * fresh one.
 */
async function moveExistingJob(
  queue: ReturnType<typeof sequenceQueue>,
  jobId: string,
  payload: { taskId: string; expectedEnrollmentId?: string },
  delay: number
): Promise<RescheduleResult | null> {
  const addOptions = {
    ...DEFAULT_JOB_OPTIONS,
    ...JOB_OPTIONS[JobType.SEQUENCE_EXECUTE_TASK],
    delay,
    jobId,
  };

  const job = await queue.getJob(jobId);
  if (!job) {
    // The mirror says queued and the queue disagrees: lost before execution. Re-add under the same
    // id at the new target, leaving the JobRun's recorded history alone.
    await queue.add(JobType.SEQUENCE_EXECUTE_TASK, payload, addOptions);
    return { ok: true, outcome: 'repaired', jobId };
  }

  const state = await job.getState();

  if (state === 'delayed') {
    // The cheapest and safest move: one job, one JobRun, one identity — only the fire time moves.
    await job.changeDelay(delay);
    return { ok: true, outcome: 'moved', jobId };
  }

  if (state === 'active') {
    return {
      ok: false,
      refusal: 'execution_in_flight',
      detail: `Job ${jobId} is running; retry once it settles.`,
    };
  }

  if (state === 'waiting' || state === 'prioritized' || state === 'waiting-children') {
    // Due imminently and not yet claimed. Replacing it in place is the only way to stop it firing
    // ahead of the resumed schedule; if a worker takes it first, `remove` throws and we refuse
    // rather than schedule a second execution beside it.
    try {
      await job.remove();
    } catch (err) {
      return {
        ok: false,
        refusal: 'execution_in_flight',
        detail: `Job ${jobId} could not be replaced: ${(err as Error).message}`,
      };
    }
    await queue.add(JobType.SEQUENCE_EXECUTE_TASK, payload, addOptions);
    return { ok: true, outcome: 'replaced', jobId };
  }

  // completed / failed / unknown — the original is spent.
  return null;
}
