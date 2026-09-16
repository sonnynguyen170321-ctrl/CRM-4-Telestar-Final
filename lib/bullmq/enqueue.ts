import crypto from 'node:crypto';
import type { JobsOptions } from 'bullmq';
import { jobQueue, type JobPayload, type JobType } from './types';
import { DEFAULT_JOB_OPTIONS, JOB_OPTIONS } from './jobOptions';
import { sequenceQueue, emailQueue, importQueue, syncQueue, maintenanceQueue, agentQueue } from './queues';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { tenantStorage } from '@/lib/tenant-context';

function resolveQueue(jobType: JobType) {
  const queueName = jobQueue(jobType);
  switch (queueName) {
    case 'sequence': return sequenceQueue();
    case 'email': return emailQueue();
    case 'import': return importQueue();
    case 'sync': return syncQueue();
    case 'maintenance': return maintenanceQueue();
    case 'agent': return agentQueue();
  }
}

function buildDedupeKey(tenantId: string, jobType: JobType, payload: Record<string, unknown>): string {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(`${tenantId}:${jobType}:${stable}`).digest('hex');
}

export interface EnqueueOptions {
  delay?: number;
  dedupeKey?: string;
  jobId?: string;
  priority?: number;
  tenantId?: string;
}

/**
 * Upsert the durable JobRun mirror for a (dedupeKey, jobType, tenant). Resetting an
 * existing row back to 'queued' clears prior execution stats so the UI reflects a fresh run.
 * Shared by `enqueue` and `enqueueImmediate`.
 */
/**
 * States in which a BullMQ job is still going to run. Listed explicitly, and matched positively,
 * so that a state this code has never heard of is treated as live — a missed cycle costs one
 * scheduler tick, a spurious re-add costs a duplicate email.
 */
const LIVE_JOB_STATES = new Set(['waiting', 'waiting-children', 'active', 'delayed', 'prioritized', 'paused']);

async function upsertJobRun(
  dedupeKey: string,
  jobType: JobType,
  tenantId: string,
  maxAttempts: number,
) {
  return tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    return prisma.jobRun.upsert({
      where: { dedupeKey },
      create: {
        queueName: jobQueue(jobType),
        jobName: jobType,
        dedupeKey,
        status: 'queued',
        tenantId,
        maxAttempts,
      },
      update: {
        status: 'queued',
        attempts: 0,
        enqueuedAt: new Date(),
        startedAt: null,
        completedAt: null,
        failedReason: null,
        result: Prisma.DbNull,
        progress: Prisma.DbNull,
      },
    });
  });
}

/**
 * The tenant a job belongs to.
 *
 * No fallback. `tenantId` becomes the `JobRun` row's tenant, and `workerUtils` reads it back to
 * decide which tenant the job *executes* as — so a fabricated one here is not a labelling mistake,
 * it is a job running against the wrong org's data. It also seeds the dedupe key, where a shared
 * default means two tenants' identical jobs collide and one is silently dropped.
 *
 * Every call site already passes it; this makes that a rule instead of a habit.
 */
function requireJobTenant(tenantId: string | undefined, jobType: JobType): string {
  if (!tenantId) {
    throw new Error(`enqueue(${jobType}) requires a tenantId: refusing to queue work for an unknown tenant`);
  }
  return tenantId;
}

export async function enqueue<T extends JobType>(
  jobType: T,
  payload: JobPayload[T],
  opts: EnqueueOptions = {},
): Promise<string> {
  const queue = resolveQueue(jobType);
  const tenantId = requireJobTenant(opts.tenantId, jobType);
  const dedupeKey = opts.dedupeKey || buildDedupeKey(tenantId, jobType, payload as Record<string, unknown>);

  const jobOptions: JobsOptions = {
    ...DEFAULT_JOB_OPTIONS,
    ...JOB_OPTIONS[jobType],
    delay: opts.delay,
    priority: opts.priority,
  };

  // 1. Create or update the JobRun record in Postgres to track progress durable mirror
  const jobRun = await upsertJobRun(dedupeKey, jobType, tenantId, (jobOptions.attempts as number) || 3);

  const resolvedJobId = opts.jobId || jobRun.id;

  // 2. Reclaim the id if the previous occurrence is over.
  //
  // The job id has to be `JobRun.id` — the worker reads `job.id` back as the JobRun primary key
  // (`workerUtils.ts`). It is therefore stable for a stable payload, and BullMQ, handed an id it
  // already holds, returns that job and queues nothing:
  //
  //     addStandardJob-9.lua:92   if rcall("EXISTS", jobIdKey) == 1 then return handleDuplicatedJob(...)
  //
  // With `removeOnComplete: { age: 86400 * 3 }` a finished job's hash outlives the job by days, so
  // a recurring job ran once and every cycle afterwards was dropped without an error anywhere.
  // Inbox sync died this way on 2026-09-16: ~720 enqueues in a day, four ids in
  // `bull:sync:completed`, zero executions, and a cron logging `{"accounts":4,"enqueued":4}`
  // throughout. `enqueueImmediate` below already reclaimed terminal ids, which is why the manual
  // "run now" button worked while the scheduler did not.
  //
  // A live job is the de-duplication that matters: adding again would mean a second send for the
  // same payload, so leave it alone. Anything else — finished, failed, or listed nowhere at all —
  // is history, and its id is free.
  const existing = await queue.getJob(resolvedJobId);
  if (existing) {
    const state = await existing.getState();
    if (LIVE_JOB_STATES.has(state)) return resolvedJobId;
    if (state === 'unknown') {
      // `getStateV2-8.lua` falls through to 'unknown' when the hash is in no list: not completed,
      // failed, delayed, prioritized, active, waiting or waiting-children. No worker can ever pick
      // that job up, so holding the id would wedge the schedule exactly as the dedupe key did.
      // It should not happen; say so rather than reclaiming a job in silence.
      console.warn(`[bullmq] reclaiming ${jobType} job ${resolvedJobId}: hash present but in no list`);
    }
    await existing.remove();
  }

  await queue.add(jobType, payload, {
    ...jobOptions,
    jobId: resolvedJobId,
  });

  return resolvedJobId;
}

/**
 * Re-schedule a job whose payload does not change between attempts.
 *
 * A plain `enqueue` cannot do this. Identical payload → identical dedupeKey → identical
 * JobRun.id → identical BullMQ jobId, and both `queue.add` and the deduplication window
 * drop the second job, so the reschedule silently never happens and the work stalls. The
 * deferral paths (send window, quota, mailbox pause) and the maintenance repairs all
 * re-issue the same payload, so they mix a discriminator into the dedupe key to get a
 * fresh JobRun + jobId.
 *
 * The discriminator must be derived from the *target* of the reschedule (usually the new
 * due timestamp), not from the clock: two workers deferring the same task to the same
 * moment then collapse to one job, which is exactly the dedupe behaviour we still want.
 */
export async function enqueueReschedule<T extends JobType>(
  jobType: T,
  payload: JobPayload[T],
  opts: { tenantId?: string; delay?: number; discriminator: string },
): Promise<string> {
  const tenantId = requireJobTenant(opts.tenantId, jobType);
  const base = buildDedupeKey(tenantId, jobType, payload as Record<string, unknown>);
  const dedupeKey = crypto
    .createHash('sha256')
    .update(`${base}:${opts.discriminator}`)
    .digest('hex');

  return enqueue(jobType, payload, { tenantId, delay: opts.delay, dedupeKey });
}

/**
 * Force a job to run immediately, fast-forwarding any job already scheduled for the same
 * payload. Used by "Send Now" / run-now.
 *
 * Why a plain `enqueue(..., { delay: 0 })` is NOT enough: for an auto-send email step,
 * `createTaskForStep` already enqueued a *delayed* SEQUENCE_EXECUTE_TASK with the SAME
 * payload → same dedupeKey → same JobRun.id → same BullMQ jobId. A second `add` with that
 * jobId is ignored by BullMQ, and the 7-day deduplication window blocks it too, so the
 * original multi-day delay stands and the send never fast-forwards. Here we instead PROMOTE
 * the existing delayed job to run now; if there is no live job (a non-autoComplete step, or
 * it already ran), we add a fresh immediate one. Either way we keep the
 * `JobRun.id == jobId` invariant that `wrapProcessor` relies on to resolve tenant/lifecycle.
 *
 * Idempotency: the SEQUENCE_EXECUTE_TASK handler re-checks task status and CAS-locks before
 * sending, so a stray duplicate can never double-send.
 */
export async function enqueueImmediate<T extends JobType>(
  jobType: T,
  payload: JobPayload[T],
  opts: { tenantId?: string } = {},
): Promise<string> {
  const queue = resolveQueue(jobType);
  const tenantId = requireJobTenant(opts.tenantId, jobType);
  const dedupeKey = buildDedupeKey(tenantId, jobType, payload as Record<string, unknown>);

  const attempts = (JOB_OPTIONS[jobType]?.attempts as number) ?? (DEFAULT_JOB_OPTIONS.attempts as number) ?? 3;
  const jobRun = await upsertJobRun(dedupeKey, jobType, tenantId, attempts);
  const jobId = jobRun.id;

  // Reschedule the existing job for this exact payload instead of colliding with it.
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'delayed') {
      await existing.promote(); // move delayed → waiting so a worker picks it up now
      return jobId;
    }
    // Already waiting/active/prioritized → it will run imminently; nothing to do.
    if (state !== 'completed' && state !== 'failed') {
      return jobId;
    }
    // Terminal job still occupying the id → remove so we can add a fresh run.
    await existing.remove();
  }

  // No live job to promote → add a fresh immediate one. No `deduplication` here so a lingering
  // dedup key from the original delayed add can't drop it.
  const jobOptions: JobsOptions = {
    ...DEFAULT_JOB_OPTIONS,
    ...JOB_OPTIONS[jobType],
    delay: 0,
  };
  await queue.add(jobType, payload, { ...jobOptions, jobId });

  return jobId;
}
