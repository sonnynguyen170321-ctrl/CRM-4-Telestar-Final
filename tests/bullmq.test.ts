import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enqueue } from '@/lib/bullmq/enqueue';
import { wrapProcessor } from '@/lib/bullmq/workerUtils';
import { prisma } from '@/lib/prisma';
import { JobType } from '@/lib/bullmq/types';
import { tenantStorage } from '@/lib/tenant-context';
import { startImportWorkflow } from '@/lib/workflows/import';
import { startSequenceEnrollWorkflow, enqueueSequenceAdvanceWorkflow } from '@/lib/workflows/sequence';
import { enqueueEmailSendWorkflow } from '@/lib/workflows/email';

// Mock BullMQ Queue and Worker to avoid connecting to real Redis during tests
vi.mock('bullmq', async (importOriginal) => {
  const original = await importOriginal<typeof import('bullmq')>();
  return {
    ...original,
    Queue: class {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      async add(name: string, data: any, opts: any) {
        return { id: opts.jobId || 'mock-job-id', name, data, opts };
      }
      async close() {}
    },
    Worker: class {
      constructor() {}
      async close() {}
    },
  };
});

describe('BullMQ Foundation & JobRun Tracking', () => {
  const tenantId = 'default-tenant';

  beforeEach(async () => {
    // Clear JobRuns before each test under the default tenant context
    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      await prisma.jobRun.deleteMany();
    });
  });

  it('should create a queued JobRun in database on enqueue', async () => {
    const payload = { startedAt: new Date().toISOString() };
    
    const jobId = await enqueue(JobType.MAINTENANCE_HEALTHCHECK, payload, { tenantId });
    
    // Check if JobRun was created
    const jobRun = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findUnique({ where: { id: jobId } });
    });

    expect(jobRun).toBeDefined();
    expect(jobRun?.status).toBe('queued');
    expect(jobRun?.jobName).toBe(JobType.MAINTENANCE_HEALTHCHECK);
    expect(jobRun?.tenantId).toBe(tenantId);
  });

  it('should reuse and reset JobRun record for duplicate enqueue requests', async () => {
    const payload = { startedAt: new Date().toISOString() };
    
    // First enqueue
    const jobId1 = await enqueue(JobType.MAINTENANCE_HEALTHCHECK, payload, { tenantId });
    
    // Simulate job starting and finishing
    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      await prisma.jobRun.update({
        where: { id: jobId1 },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: { done: true }
        }
      });
    });

    // Enqueue identical job (triggers deduplication/upsert logic)
    const jobId2 = await enqueue(JobType.MAINTENANCE_HEALTHCHECK, payload, { tenantId });
    
    expect(jobId2).toBe(jobId1);

    const jobRun = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findUnique({ where: { id: jobId2 } });
    });

    // Check that status got reset to queued and execution stats cleared
    expect(jobRun?.status).toBe('queued');
    expect(jobRun?.completedAt).toBeNull();
    expect(jobRun?.progress).toBeNull();
  });

  it('should transition JobRun to active and completed with wrapProcessor', async () => {
    // 1. Create a queued JobRun
    const payload = { startedAt: new Date().toISOString() };
    const jobId = await enqueue(JobType.MAINTENANCE_HEALTHCHECK, payload, { tenantId });

    // 2. Wrap a processor that completes successfully
    const mockProcessor = wrapProcessor(async (job) => {
      // Mock progress update inside processor
      await job.updateProgress({ step: 'tested' });
      return { ok: true };
    });

    // Mock BullMQ Job object
    const mockJob: any = {
      id: jobId,
      attemptsMade: 1,
      client: null,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };

    // 3. Run the wrapped processor
    const result = await mockProcessor(mockJob);
    expect(result).toEqual({ ok: true });

    // 4. Verify JobRun has been updated in database
    const jobRun = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findUnique({ where: { id: jobId } });
    });

    expect(jobRun?.status).toBe('completed');
    expect(jobRun?.startedAt).not.toBeNull();
    expect(jobRun?.completedAt).not.toBeNull();
    expect(jobRun?.attempts).toBe(1);
    expect(jobRun?.progress).toEqual({ step: 'tested' });
    expect(jobRun?.result).toEqual({ ok: true });
    expect(jobRun?.failedReason).toBeNull();
  });

  it('should transition JobRun to failed with wrapProcessor on error', async () => {
    // 1. Create a queued JobRun
    const payload = { startedAt: new Date().toISOString() };
    const jobId = await enqueue(JobType.MAINTENANCE_HEALTHCHECK, payload, { tenantId });

    // 2. Wrap a processor that throws an error
    const mockProcessor = wrapProcessor(async () => {
      throw new Error('Test processor failure');
    });

    // Mock BullMQ Job object
    const mockJob: any = {
      id: jobId,
      attemptsMade: 2,
      client: null,
      updateProgress: vi.fn(),
    };

    // 3. Run and expect error to propagate
    await expect(mockProcessor(mockJob)).rejects.toThrow('Test processor failure');

    // 4. Verify JobRun has failed state in database
    const jobRun = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findUnique({ where: { id: jobId } });
    });

    expect(jobRun?.status).toBe('failed');
    expect(jobRun?.completedAt).not.toBeNull();
    expect(jobRun?.failedReason).toBe('Test processor failure');
    expect(jobRun?.result).toBeNull();
  });
});

describe('Workflows Enqueuing Helpers', () => {
  const tenantId = 'default-tenant';

  beforeEach(async () => {
    // Belt and braces with the `finally` in the production-policy test below: a stubbed
    // `NODE_ENV=production` that survives one test makes every read in the next one return
    // `null`, which reads as several unrelated intermittent failures rather than as leakage.
    vi.unstubAllEnvs();
    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      await prisma.jobRun.deleteMany();
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should enqueue import workflow successfully', async () => {
    const jobId = await startImportWorkflow({
      batchId: 'batch-123',
      assignedToId: 'user-1',
      campaignId: 'campaign-1',
      tenantId,
      userId: 'user-1',
    });
    expect(jobId).toBeDefined();

    const jobRun = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findUnique({ where: { id: jobId } });
    });
    expect(jobRun?.jobName).toBe(JobType.IMPORT_PARSE);
  });

  it('should enqueue sequence enrollment workflows successfully', async () => {
    const jobIdEnroll = await startSequenceEnrollWorkflow('lead-1', 'seq-1', 'user-1', tenantId);
    expect(jobIdEnroll).toBeDefined();

    const jobIdAdvance = await enqueueSequenceAdvanceWorkflow('lead-1', 'seq-1', 2, tenantId);
    expect(jobIdAdvance).toBeDefined();

    const jobRuns = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findMany();
    });
    expect(jobRuns.map(r => r.jobName)).toContain(JobType.SEQUENCE_ENROLL);
    expect(jobRuns.map(r => r.jobName)).toContain(JobType.SEQUENCE_ADVANCE);
  });

  it('should enqueue email workflows successfully', async () => {
    const payload = {
      outboundMessageId: 'msg-1',
      accountId: 'acc-1',
      to: 'test@example.com',
      subject: 'Hello',
      body: 'World',
    };
    const jobId = await enqueueEmailSendWorkflow(payload, tenantId);
    expect(jobId).toBeDefined();

    const jobRun = await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findUnique({ where: { id: jobId } });
    });
    expect(jobRun?.jobName).toBe(JobType.EMAIL_SEND);
  });

  it('should resolve worker job tenant via bootstrap resolver without ambient tenant context', async () => {
    const payload = { startedAt: new Date().toISOString() };
    const jobId = await enqueue(JobType.MAINTENANCE_HEALTHCHECK, payload, { tenantId });

    // Call resolveWorkerJobTenant directly outside of any tenantStorage context
    const resolvedTenant = await (await import('@/lib/prisma')).resolveWorkerJobTenant(jobId);
    expect(resolvedTenant).toBe(tenantId);

    // Call wrapProcessor on job without pre-setting tenant context
    const mockProcessor = wrapProcessor(async (_job) => {
      // Inside processor, verify ambient tenant context is properly established
      const activeStore = (await import('@/lib/prisma')).tenantStorage.getStore();
      expect(activeStore?.tenantId).toBe(tenantId);
      expect(activeStore?.bypassRls).toBe(true);
      return { handled: true };
    });

    const mockJob: any = {
      id: jobId,
      attemptsMade: 1,
      client: null,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };

    const res = await mockProcessor(mockJob);
    expect(res).toEqual({ handled: true });

    const jobRun = await (await import('@/lib/prisma')).tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      return prisma.jobRun.findUnique({ where: { id: jobId } });
    });
    expect(jobRun?.status).toBe('completed');
    expect(jobRun?.result).toEqual({ handled: true });
  });

  /**
   * The regression the bootstrap resolver exists for.
   *
   * The test above proves the resolver *works*. It does not prove it is *necessary* — it would
   * pass just as well against a plain `prisma.jobRun.findUnique()`, which is precisely the
   * lookup that failed in production and produced a worker that could consume nothing. So this
   * asserts the asymmetry directly: the model-level read refuses without an ambient tenant,
   * and the raw bootstrap resolver succeeds in the same conditions.
   */
  it('the model-level lookup goes silently empty under the production tenant policy; the raw resolver does not', async () => {
    const jobId = await enqueue(
      JobType.MAINTENANCE_HEALTHCHECK,
      { startedAt: new Date().toISOString() },
      { tenantId }
    );

    // Exactly the state a worker starts in: a job arrives and nothing has established a tenant.
    expect(tenantStorage.getStore()).toBeUndefined();

    // The policy has to be the production one for this to mean anything. `lib/prisma.ts` treats
    // `NODE_ENV !== 'production'` as "local or script" and quietly grants bypass when no tenant
    // context exists — so under test defaults a plain model read succeeds, and a regression
    // written against those defaults would pass against the very bug it is meant to catch.
    // `vi.stubEnv`, not a manual save/restore: a manual restore in a `finally` still leaks if
    // the assertion inside throws in a way that skips it, and a leaked `NODE_ENV=production`
    // silently turns every subsequent read in this file into `null` — which surfaces as
    // unrelated tests failing, several of them, intermittently. `unstubAllEnvs` in `afterEach`
    // runs regardless of outcome.
    try {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('BYPASS_RLS', '');

      // Not a throw — `null`. That is the whole reason the original failure was hard to read:
      // the worker asked for its JobRun, got nothing back, and reported "JobRun not found",
      // which looks like a missing record rather than a tenancy bootstrap problem. A worker in
      // this state consumes no jobs at all.
      await expect(prisma.jobRun.findUnique({ where: { id: jobId } })).resolves.toBeNull();

      // The bootstrap resolver bypasses the model extension entirely, so it answers in exactly
      // the conditions the model path cannot.
      const { resolveWorkerJobTenant } = await import('@/lib/prisma');
      await expect(resolveWorkerJobTenant(jobId)).resolves.toBe(tenantId);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('bootstraps from the durable JobRun, not from the job payload', async () => {
    // `job.data.tenantId` is transport, and transport is not authority. A payload claiming
    // another tenant must change nothing about which tenant the processor runs as — otherwise
    // a forged or stale job could cross a tenant boundary.
    const jobId = await enqueue(
      JobType.MAINTENANCE_HEALTHCHECK,
      { startedAt: new Date().toISOString() },
      { tenantId }
    );

    const seen: Array<string | undefined> = [];
    const processor = wrapProcessor(async () => {
      seen.push(tenantStorage.getStore()?.tenantId);
      // A tenant-aware model read inside the processor: this is what the bootstrap has to make
      // possible, and it is the thing that was broken.
      const own = await prisma.jobRun.findUnique({ where: { id: jobId } });
      expect(own?.id).toBe(jobId);
      expect(own?.status).toBe('active');
      return { ok: true };
    });

    await processor({
      id: jobId,
      attemptsMade: 0,
      data: { tenantId: 'some-other-tenant-that-must-be-ignored' },
      client: null,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as never);

    expect(seen).toEqual([tenantId]);

    const jobRun = await tenantStorage.run({ tenantId, bypassRls: true }, () =>
      prisma.jobRun.findUnique({ where: { id: jobId } })
    );
    // queued → active → completed: the middle state is asserted from inside the processor
    // above, where it is the only place it is ever observable.
    expect(jobRun?.status).toBe('completed');
    expect(jobRun?.tenantId).toBe(tenantId);
    expect(jobRun?.startedAt).not.toBeNull();
    expect(jobRun?.completedAt).not.toBeNull();
  });
});
