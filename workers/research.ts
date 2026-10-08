import { createAppWorker } from '@/lib/bullmq';
import { JobType, QUEUES, type ResearchDiscoverPayload, type ResearchVerifyPayload } from '@/lib/bullmq/types';
import { tenantStorage } from '@/lib/tenant-context';
import { runResearchSlice } from '@/lib/research/runner';
import { runVerificationSlice } from '@/lib/research/verify';
import { createVerifyBatch } from '@/lib/research/verifyBatch';

/**
 * The research worker: one `research.discover` slice, or one `research.verify` slice, per job.
 *
 * Thin on purpose — the claim, pause, stall and continuation rules live in `lib/research/runner.ts` and
 * `lib/research/verify.ts` where they can be tested without a broker. `wrapProcessor` has already
 * resolved the job's tenant from its `JobRun` and set the context, so the tenant is read from there
 * rather than trusted from the payload.
 *
 * An unknown job name throws. It used to return, so a job this worker did not understand completed as
 * if it had run — the failure a rolling deploy produces when a new web enqueues a job an old worker has
 * never heard of.
 *
 * Concurrency 2: a slice is mostly waiting on search providers, page fetches or the model, and one long
 * run must not hold the only slot while another tenant's run waits.
 */
const RESEARCH_CONCURRENCY = 2;

const verifyBatch = createVerifyBatch();

export function createResearchWorker() {
  return createAppWorker(
    QUEUES.RESEARCH,
    async (job) => {
      const tenantId = tenantStorage.getStore()?.tenantId;
      if (!tenantId) throw new Error(`${job.name} ran without a tenant context`);
      if (job.name === JobType.RESEARCH_DISCOVER) return runResearchSlice(job.data as ResearchDiscoverPayload, tenantId);
      if (job.name === JobType.RESEARCH_VERIFY) return runVerificationSlice(job.data as ResearchVerifyPayload, tenantId, { verifyBatch });
      throw new Error(`research worker received an unknown job: ${job.name}`);
    },
    { concurrency: RESEARCH_CONCURRENCY }
  );
}
