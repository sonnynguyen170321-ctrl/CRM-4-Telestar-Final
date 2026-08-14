#!/usr/bin/env node
/**
 * Verification probe: prove the background BullMQ import worker is actively
 * consuming jobs from Redis before running the full E2E suite.
 *
 * Enqueues an IMPORT_PARSE job targeting a nonexistent batchId.
 * `handleImportParse` immediately returns `{ skipped: true, reason: 'batch_not_found' }`
 * without touching business records, but this exercises:
 *   1. enqueue() → JobRun mirror creation + BullMQ queue.add()
 *   2. BullMQ Worker popping the job from Redis
 *   3. wrapProcessor() setting JobRun active → running handler → setting JobRun completed
 */
import { prisma } from '../lib/prisma';
import { enqueue } from '../lib/bullmq/enqueue';
import { JobType, type ImportParsePayload } from '../lib/bullmq/types';
import { importQueue } from '../lib/bullmq/queues';
import { closeConnection } from '../lib/bullmq/connection';
import fs from 'fs';

const PROBE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

async function main(): Promise<void> {
  const probeBatchId = `probe-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = 'default-tenant';

  console.log(`[probe] Enqueuing import probe job with batchId=${probeBatchId}...`);

  const payload: ImportParsePayload = {
    batchId: probeBatchId,
    assignedToId: 'probe-user',
    tenantId,
    userId: 'probe-user',
    targetType: 'lead',
    campaignId: 'probe-campaign',
    initialStage: 'new',
    defaultResolution: 'skip',
    emailQualityMode: 'recommended',
  };

  const jobId = await enqueue(JobType.IMPORT_PARSE, payload, { tenantId });
  console.log(`[probe] Enqueued JobRun ID / BullMQ Job ID: ${jobId}`);

  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    const jobRun = await prisma.jobRun.findUnique({
      where: { id: jobId },
    });

    if (jobRun) {
      lastStatus = jobRun.status;
      if (jobRun.status === 'completed') {
        const result = jobRun.result as { skipped?: boolean; reason?: string } | null;
        if (result?.reason === 'batch_not_found' || result?.skipped === true) {
          console.log(`[probe] SUCCESS: Import worker processed probe job (status=${jobRun.status}, reason=${result?.reason})`);
          await prisma.jobRun.delete({ where: { id: jobId } }).catch(() => {});
          process.exit(0);
        }
      }
      if (jobRun.status === 'failed') {
        console.error(`[probe] FAILURE: Import probe job marked as failed: ${jobRun.failedReason}`);
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Diagnostic dump on failure
  console.error(`\n::error::[probe] Import worker failed to process probe job within ${PROBE_TIMEOUT_MS / 1000}s (last status: ${lastStatus})`);

  try {
    const q = importQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
    ]);
    console.error(`[probe] Import Queue counts: waiting=${waiting}, active=${active}, completed=${completed}, failed=${failed}, delayed=${delayed}`);

    const workers = await q.getWorkers();
    console.error(`[probe] Active workers on 'import' queue: ${workers.length}`);
    for (const w of workers) {
      console.error(`[probe]   worker: id=${w.id}, name=${w.name}, addr=${w.addr}`);
    }
  } catch (err) {
    console.error('[probe] Failed to inspect queue:', err);
  }

  if (fs.existsSync('worker.log')) {
    console.error('\n--- worker.log (tail 40) ---');
    const content = fs.readFileSync('worker.log', 'utf8');
    console.error(content.split('\n').slice(-40).join('\n'));
  }

  process.exit(1);
}

main()
  .catch((err) => {
    console.error('[probe] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeConnection().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });
