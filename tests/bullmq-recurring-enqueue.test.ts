/**
 * A recurring job must run every cycle, not once.
 *
 * `enqueue` derives a stable `dedupeKey` from (tenant, jobType, payload) and uses the resulting
 * `JobRun.id` as the BullMQ job id — it has to, because the worker reads `job.id` back as the
 * JobRun primary key (`lib/bullmq/workerUtils.ts:20`). BullMQ, given a job id that already
 * exists, returns the existing job and adds nothing:
 *
 *     addStandardJob-9.lua:92
 *       if rcall("EXISTS", jobIdKey) == 1 then
 *           return handleDuplicatedJob(...)
 *
 * and `removeOnComplete` keeps a finished job's hash for days (`age: 86400 * 3`). So a job with a
 * stable payload ran once and every later cycle was dropped in silence.
 *
 * Observed in production 2026-09-16: inbox sync enqueued four accounts every two minutes and
 * logged `{"accounts":4,"enqueued":4}` roughly 720 times in a day while `bull:sync:completed`
 * held the same four ids and not one job executed. Deleting those four hashes by hand restored
 * sync for exactly one cycle, after which the same ids were back and the block re-armed.
 *
 * The existing suites never caught it because their Queue mock overwrote the store on `add`.
 * This one models the Lua branch instead, so a regression fails here rather than in production.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

type MockJob = { state: string; removed: boolean };

const { jobStore, addAttempts } = vi.hoisted(() => ({
  jobStore: new Map<string, MockJob>(),
  addAttempts: [] as { id: string; accepted: boolean }[],
}));

vi.mock('bullmq', async (importOriginal) => {
  const original = await importOriginal<typeof import('bullmq')>();
  return {
    ...original,
    Queue: class {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      async add(_name: string, _data: unknown, opts: { jobId: string; delay?: number }) {
        const id = opts.jobId;
        const existing = jobStore.get(id);
        // handleDuplicatedJob: the id is taken, so nothing is queued and no error is raised.
        if (existing && !existing.removed) {
          addAttempts.push({ id, accepted: false });
          return { id };
        }
        jobStore.set(id, { state: (opts.delay ?? 0) > 0 ? 'delayed' : 'waiting', removed: false });
        addAttempts.push({ id, accepted: true });
        return { id };
      }
      async getJob(id: string) {
        const rec = jobStore.get(id);
        if (!rec || rec.removed) return undefined;
        return {
          id,
          getState: async () => rec.state,
          promote: async () => {
            rec.state = 'waiting';
          },
          remove: async () => {
            rec.removed = true;
            jobStore.delete(id);
          },
        };
      }
      async close() {}
    },
    Worker: class {
      constructor() {}
      async close() {}
    },
  };
});

import { enqueue, enqueueReschedule } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { RECURRING_TEST_TENANT_ID } from './setup/db-baseline';

const tenantId = RECURRING_TEST_TENANT_ID;

/** The cycle a worker completes: the job settles but its hash stays, exactly as BullMQ leaves it. */
function markCompleted(jobId: string) {
  const rec = jobStore.get(jobId);
  if (rec) rec.state = 'completed';
}

beforeEach(async () => {
  jobStore.clear();
  addAttempts.length = 0;
  await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    await prisma.jobRun.deleteMany({ where: { tenantId } });
  });
});

describe('recurring enqueue', () => {
  it('queues the next cycle after the previous run completed', async () => {
    const payload = { accountId: 'acct-recurring-1' };

    const first = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });
    expect(jobStore.get(first)?.state).toBe('waiting');
    markCompleted(first);

    // Two minutes later the scheduler asks for the same account again.
    const second = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });

    expect(second).toBe(first); // same JobRun mirror — the worker resolves the row by this id
    expect(jobStore.get(second)?.state).toBe('waiting');
    expect(addAttempts.filter((a) => a.accepted)).toHaveLength(2);
  });

  it('keeps queueing on every later cycle, not just the second', async () => {
    const payload = { accountId: 'acct-recurring-2' };
    for (let cycle = 0; cycle < 5; cycle++) {
      const id = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });
      expect(jobStore.get(id)?.state, `cycle ${cycle} was dropped`).toBe('waiting');
      markCompleted(id);
    }
    expect(addAttempts.filter((a) => a.accepted)).toHaveLength(5);
  });

  it('reclaims a job whose hash is in no list at all', async () => {
    // getStateV2-8.lua returns 'unknown' when the hash exists but is in none of the completed,
    // failed, delayed, prioritized, active, waiting or waiting-children sets. No worker can reach
    // such a job, so treating it as live would wedge the schedule permanently.
    const payload = { accountId: 'acct-unknown-state' };
    const first = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });
    const rec = jobStore.get(first);
    if (rec) rec.state = 'unknown';

    const second = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });
    expect(jobStore.get(second)?.state).toBe('waiting');
  });

  it('re-queues after a failed run as well', async () => {
    const payload = { accountId: 'acct-recurring-3' };
    const first = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });
    const rec = jobStore.get(first);
    if (rec) rec.state = 'failed';

    const second = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });
    expect(jobStore.get(second)?.state).toBe('waiting');
  });
});

describe('in-flight de-duplication is preserved', () => {
  // This is the half that must NOT regress: a second enqueue of a job that is still waiting,
  // running or delayed would mean a second email to the same prospect.
  for (const state of ['waiting', 'active', 'delayed', 'prioritized']) {
    it(`does not add a second job while one is ${state}`, async () => {
      const payload = { accountId: `acct-inflight-${state}` };
      const first = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });
      const rec = jobStore.get(first);
      if (rec) rec.state = state;

      const second = await enqueue(JobType.EMAIL_SYNC, payload, { tenantId });

      expect(second).toBe(first);
      expect(jobStore.get(first)?.state, 'an in-flight job must not be displaced').toBe(state);
      expect(addAttempts.filter((a) => a.accepted)).toHaveLength(1);
    });
  }

  it('lets a running job schedule its own retry through enqueueReschedule', async () => {
    // The import commit barrier defers itself when chunks are still writing. A plain `enqueue`
    // from inside the running job cannot work — the job's own id is active, so the retry is the
    // one thing the in-flight guard above is designed to refuse. `enqueueReschedule` mixes a
    // discriminator into the dedupe key and therefore gets its own id.
    const payload = { batchId: 'batch-deferring' };
    const running = await enqueue(JobType.IMPORT_COMMIT, payload, { tenantId });
    const rec = jobStore.get(running);
    if (rec) rec.state = 'active';

    const retry = await enqueueReschedule(JobType.IMPORT_COMMIT, payload, {
      tenantId,
      delay: 1000,
      discriminator: 'barrier:2026-09-16T07:26:39.000Z',
    });

    expect(retry).not.toBe(running);
    expect(jobStore.get(running)?.state, 'the running job must be left alone').toBe('active');
    expect(jobStore.get(retry)?.state).toBe('delayed');
  });

  it('collapses two workers deferring to the same moment into one job', async () => {
    const payload = { batchId: 'batch-collapsing' };
    const a = await enqueueReschedule(JobType.IMPORT_COMMIT, payload, {
      tenantId, delay: 1000, discriminator: 'barrier:2026-09-16T07:26:40.000Z',
    });
    const b = await enqueueReschedule(JobType.IMPORT_COMMIT, payload, {
      tenantId, delay: 1000, discriminator: 'barrier:2026-09-16T07:26:40.000Z',
    });
    expect(b).toBe(a);
    expect(addAttempts.filter((x) => x.accepted)).toHaveLength(1);
  });

  it('leaves a delayed sequence step on its own schedule', async () => {
    // A sequence step is enqueued with a delay at enrollment time. A later enqueue of the same
    // step must not pull it forward — that is `enqueueImmediate`'s job, and only on request.
    const payload = { taskId: 'task-delayed-1' };
    const first = await enqueue(JobType.SEQUENCE_EXECUTE_TASK, payload, { tenantId, delay: 60_000 });
    expect(jobStore.get(first)?.state).toBe('delayed');

    await enqueue(JobType.SEQUENCE_EXECUTE_TASK, payload, { tenantId, delay: 60_000 });

    expect(jobStore.get(first)?.state).toBe('delayed');
    expect(addAttempts.filter((a) => a.accepted)).toHaveLength(1);
  });
});
