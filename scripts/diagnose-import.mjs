#!/usr/bin/env node
/**
 * Dump the durable state of the most recent lead imports.
 *
 * Exists because `e2e/user-flow-31step.spec.ts` can only report the symptom — "Import never
 * materialised any leads within 90000ms" — which is consistent with six different failures, and
 * three speculative repairs were pushed against the wrong one before this existed. It answers,
 * from rows rather than inference, exactly where the chain stopped:
 *
 *   parse queued, never ran        → queue consumption defect
 *   parse failed                   → the parse exception, printed below
 *   parse ran, no chunk enqueued   → child dispatch defect
 *   chunk failed                   → the chunk exception, printed below
 *   chunk ran, rows imported       → the leads exist; an API/scope defect hid them
 *   commit wrong                   → orchestration defect
 *
 * Read-only. Prints to stdout so it lands in the CI job log, which is retrievable through the
 * API — the step summary is not.
 */
import { createAdminClient } from '../lib/db/adminClient.mjs';

const prisma = createAdminClient();
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x), 2);

async function main() {
  const batches = await prisma.importBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
  });

  console.log('=== IMPORT DIAGNOSTIC ===');
  console.log(`ImportBatch rows (latest 3): ${batches.length}`);

  for (const batch of batches) {
    console.log(`\n--- batch ${batch.id} ---`);
    console.log(j(batch));

    const rows = await prisma.importRow.groupBy({
      by: ['status'],
      where: { batchId: batch.id },
      _count: { _all: true },
    });
    console.log(`importRow status counts: ${j(rows)}`);

    const errored = await prisma.importRow.findMany({
      where: { batchId: batch.id, status: 'error' },
      select: { rowIndex: true, errors: true },
      take: 5,
    });
    if (errored.length > 0) console.log(`errored rows (first 5): ${j(errored)}`);

    const leadCount = await prisma.lead.count({ where: { tenantId: batch.tenantId } });
    console.log(`leads in tenant ${batch.tenantId}: ${leadCount}`);
  }

  // The queue's own record. `jobName` distinguishes parse / chunk / commit, and `failedReason`
  // is the exception the worker actually threw — the thing every previous diagnosis lacked.
  const jobs = await prisma.jobRun.findMany({
    where: { jobName: { contains: 'import' } },
    orderBy: { enqueuedAt: 'desc' },
    take: 25,
    select: {
      id: true, queueName: true, jobName: true, status: true, attempts: true,
      enqueuedAt: true, startedAt: true, completedAt: true, failedReason: true, result: true,
    },
  });
  console.log(`\n=== JobRun rows matching "import" (latest 25): ${jobs.length} ===`);
  console.log(j(jobs));

  if (jobs.length === 0) {
    console.log('\n>>> No import JobRun rows at all — the parse job was never recorded.');
  } else {
    const byName = {};
    for (const job of jobs) byName[job.jobName] = (byName[job.jobName] ?? 0) + 1;
    console.log(`\n>>> job name counts: ${j(byName)}`);
  }
}

main()
  .catch((err) => {
    console.error('[diagnose-import] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
