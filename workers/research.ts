import { createAppWorker } from '@/lib/bullmq';
import { JobType, QUEUES, type ResearchDiscoverPayload } from '@/lib/bullmq/types';
import { tenantStorage } from '@/lib/tenant-context';
import { runResearchSlice } from '@/lib/research/runner';

/**
 * The research worker: one `research.discover` slice per job.
 *
 * Thin on purpose — the claim, pause, stall and continuation rules live in `lib/research/runner.ts`
 * where they can be tested without a broker. `wrapProcessor` has already resolved the job's tenant
 * from its `JobRun` and set the context, so the tenant is read from there rather than trusted from
 * the payload.
 *
 * Concurrency 2: a slice is mostly waiting on search providers, and one long run must not hold the
 * only slot while another tenant's run waits. Two slices of the *same* run cannot coexist, because
 * only the runner that won the status claim — or the slice that run handed over to — ever enqueues.
 */
const RESEARCH_CONCURRENCY = 2;

export function createResearchWorker() {
  return createAppWorker(
    QUEUES.RESEARCH,
    async (job) => {
      if (job.name !== JobType.RESEARCH_DISCOVER) return;
      const tenantId = tenantStorage.getStore()?.tenantId;
      if (!tenantId) throw new Error('research.discover ran without a tenant context');
      return runResearchSlice(job.data as ResearchDiscoverPayload, tenantId);
    },
    { concurrency: RESEARCH_CONCURRENCY }
  );
}
