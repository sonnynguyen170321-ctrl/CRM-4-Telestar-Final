import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { tenantStorage } from '@/lib/tenant-context';
import { jobQueue, type JobPayload, type JobType } from './types';
import { DEFAULT_JOB_OPTIONS, JOB_OPTIONS } from './jobOptions';
import { sequenceQueue, emailQueue, importQueue, syncQueue, maintenanceQueue, agentQueue } from './queues';

/**
 * "Make sure this job exists" — the recovery-safe sibling of `enqueue` (Phase 8a).
 *
 * `enqueue` is the *intent* primitive: it upserts the `JobRun` mirror back to `queued` and
 * clears attempts, timings and results, which is right when a caller means "run this now". It is
 * wrong for a resumed launch, which means something different:
 *
 * > this job should exist; if it already does, leave it exactly as it is.
 *
 * Calling `enqueue` on resume would reset a `JobRun` that is mid-flight or already finished back
 * to `queued`, reporting a job as waiting when it has run. So this checks the durable mirror and
 * the queue first, and only creates what is genuinely missing:
 *
 * | State found | Action |
 * |---|---|
 * | `JobRun` running / completed / failed | none — it existed and executed |
 * | `JobRun` queued **and** the BullMQ job present | none — scheduling is in place |
 * | `JobRun` queued, BullMQ job gone before execution | re-add the job under the same id |
 * | neither | create the `JobRun` and the job |
 * | Redis unreachable | **throws** — the caller must not report success |
 *
 * It throws rather than logging, because the launch that calls it must stay resumable instead of
 * completing with nothing scheduled.
 */

function resolveQueue(jobType: JobType) {
  switch (jobQueue(jobType)) {
    case 'sequence': return sequenceQueue();
    case 'email': return emailQueue();
    case 'import': return importQueue();
    case 'sync': return syncQueue();
    case 'maintenance': return maintenanceQueue();
    case 'agent': return agentQueue();
  }
}

/** The same dedupe identity `enqueue` derives, so both agree on what "this job" means. */
export function buildJobDedupeKey(
  tenantId: string,
  jobType: JobType,
  payload: Record<string, unknown>
): string {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(`${tenantId}:${jobType}:${stable}`).digest('hex');
}

export type EnsureJobOutcome =
  | 'already_scheduled'
  | 'already_executed'
  | 'repaired'
  | 'created';

export interface EnsureJobResult {
  outcome: EnsureJobOutcome;
  jobId: string;
  dedupeKey: string;
}

/** Statuses that mean the job's existence is already settled — nothing to re-add. */
const SETTLED_STATUSES = new Set(['running', 'active', 'completed', 'failed']);

export async function ensureJob<T extends JobType>(
  jobType: T,
  payload: JobPayload[T],
  opts: {
    tenantId: string;
    delay?: number;
    priority?: number;
    /**
     * Override the derived identity when the caller means a *different* job for the same payload
     * — a resumed cadence whose original job already settled. It still goes through `ensureJob`
     * rather than `enqueueReschedule` so repeating the same resume converges instead of resetting
     * a truthful `JobRun` back to `queued`.
     */
    dedupeKey?: string;
  }
): Promise<EnsureJobResult> {
  const queue = resolveQueue(jobType);
  const dedupeKey =
    opts.dedupeKey ?? buildJobDedupeKey(opts.tenantId, jobType, payload as Record<string, unknown>);

  const existing = await tenantStorage.run({ tenantId: opts.tenantId, bypassRls: true }, () =>
    prisma.jobRun.findUnique({ where: { dedupeKey } })
  );

  if (existing && SETTLED_STATUSES.has(existing.status)) {
    // It ran, is running, or failed and is the retry mechanism's problem. Re-adding here would
    // duplicate delivery and rewrite a truthful record with a misleading one.
    return { outcome: 'already_executed', jobId: existing.id, dedupeKey };
  }

  if (existing) {
    const job = await queue.getJob(existing.id);
    if (job) return { outcome: 'already_scheduled', jobId: existing.id, dedupeKey };

    // The mirror says queued and the queue disagrees: the job was lost before execution. Re-add
    // it under the same id, without touching the JobRun's recorded history.
    await queue.add(jobType, payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...JOB_OPTIONS[jobType],
      delay: opts.delay,
      priority: opts.priority,
      jobId: existing.id,
    });
    return { outcome: 'repaired', jobId: existing.id, dedupeKey };
  }

  const jobOptions = { ...DEFAULT_JOB_OPTIONS, ...JOB_OPTIONS[jobType] };

  let jobRun;
  try {
    jobRun = await tenantStorage.run({ tenantId: opts.tenantId, bypassRls: true }, () =>
      prisma.jobRun.create({
        data: {
          queueName: jobQueue(jobType),
          jobName: jobType,
          dedupeKey,
          status: 'queued',
          tenantId: opts.tenantId,
          maxAttempts: (jobOptions.attempts as number) || 3,
        },
      })
    );
  } catch (err) {
    // Two ensures raced to create the same durable job. The unique dedupeKey is the arbiter, and
    // the loser converges on the winner's row instead of surfacing a raw uniqueness error — an
    // "ensure" that throws because somebody else ensured it first is not an ensure.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    return ensureJob(jobType, payload, opts);
  }

  await queue.add(jobType, payload, {
    ...jobOptions,
    delay: opts.delay,
    priority: opts.priority,
    jobId: jobRun.id,
  });

  return { outcome: 'created', jobId: jobRun.id, dedupeKey };
}
