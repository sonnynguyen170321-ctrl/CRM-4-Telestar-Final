/**
 * IMPORT_SYSTEM_QUEUE_BENCHMARK (TEL-P2-016).
 *
 * The existing benchmark mocks BullMQ and calls the worker handler directly. That is a
 * legitimate **handler** benchmark and it is kept - but it measures nothing about the queue:
 * not enqueue cost, not queue wait, not redelivery, not retry, not worker concurrency. A
 * system whose handler is fast and whose queue is broken looks identical in it.
 *
 * This runs the real thing: real Redis, real BullMQ, a real worker created by the same
 * factory production uses, and real jobs. Nothing is mocked.
 *
 *   REDIS_URL=... DATABASE_URL=... npx tsx scripts/certification/queue-load-benchmark.ts \
 *     --candidate <40-char sha> --scales 120,500,1000
 *
 * Exit code is non-zero if any scale loses or duplicates a row.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { QueueEvents } from 'bullmq';

import { getConnection, getRedisConfig } from '@/lib/bullmq/connection';
import { enqueue } from '@/lib/bullmq/enqueue';
import { importQueue, closeAllQueues } from '@/lib/bullmq/queues';
import { JobType } from '@/lib/bullmq/types';
import { prisma, tenantStorage } from '@/lib/prisma';
import { createImportWorker } from '@/workers/import';

const T = 'queue-load-tenant';
const USER = 'queue-load-user';
const CLIENT = 'queue-load-client';
const CAMPAIGN = 'queue-load-campaign';
const CHUNK_SIZE = 50;

const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

interface ScaleResult {
  rows: number;
  chunks: number;
  totalDurationMs: number;
  rowsPerSecond: number;
  queueWaitMs: { p50: number; p95: number; p99: number };
  jobProcessingMs: { p50: number; p95: number; p99: number };
  enqueueStartedAt: string;
  firstWorkerStartAt: string;
  lastRowTerminalAt: string;
  batchCommittedAt: string | null;
  failedJobs: number;
  retries: number;
  lostRows: number;
  duplicateRows: number;
  stuckRows: number;
  workerConcurrency: number;
  createdLeads: number;
  createdAccounts: number;
  createdContacts: number;
}

async function resetTenant() {
  await run(async () => {
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.task.deleteMany({ where: { tenantId: T } });
    await prisma.importRow.deleteMany({ where: { tenantId: T } });
    await prisma.importBatch.deleteMany({ where: { tenantId: T } });
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.contact.deleteMany({ where: { tenantId: T } });
    await prisma.account.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
  });
  await runSystem(async () => {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.tenant.create({ data: { id: T, name: 'Queue Load Tenant' } });
    await prisma.user.create({
      data: {
        id: USER,
        tenantId: T,
        email: 'queue-load@telestar.invalid',
        password: 'test-only-not-a-credential',
        firstName: 'Queue',
        lastName: 'Load',
        role: 'sdr',
      },
    });
  });
  await run(async () => {
    await prisma.client.create({
      data: {
        id: CLIENT,
        tenantId: T,
        name: 'Queue Load Client',
        industry: 'Tech',
        contactName: 'C',
        contactEmail: 'c@telestar.invalid',
      },
    });
    await prisma.campaign.create({
      data: {
        id: CAMPAIGN,
        tenantId: T,
        clientId: CLIENT,
        name: 'Queue Load Campaign',
        startDate: new Date('2026-08-12T00:00:00Z'),
      },
    });
  });
}

async function runScale(rows: number, concurrency: number): Promise<ScaleResult> {
  await resetTenant();

  const batch = await run(() =>
    prisma.importBatch.create({
      data: { tenantId: T, userId: USER, status: 'parsing', filename: `queue-load-${rows}.csv` },
    }),
  );

  // Build all chunks up front so enqueue timing is not polluted by row creation.
  const chunkCount = Math.ceil(rows / CHUNK_SIZE);
  const chunks: Array<{ chunkIndex: number; rowIds: string[]; rows: Record<string, unknown>[] }> = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const size = Math.min(CHUNK_SIZE, rows - chunkIndex * CHUNK_SIZE);
    const rowIds: string[] = [];
    const rowDatas: Record<string, unknown>[] = [];

    for (let offset = 0; offset < size; offset += 1) {
      const globalIndex = chunkIndex * CHUNK_SIZE + offset;
      const data = {
        firstName: `Lead_${globalIndex}`,
        lastName: `Batch_${rows}`,
        // 20 shared accounts, so concurrent workers genuinely contend on account creation.
        company: `Company_${globalIndex % 20}`,
        email: `lead_${globalIndex}_${rows}@queuebenchmark.invalid`,
        phone: `+1555${String(globalIndex).padStart(6, '0')}`,
      };
      const row = await run(() =>
        prisma.importRow.create({
          data: {
            batchId: batch.id,
            tenantId: T,
            rowIndex: globalIndex,
            status: 'valid',
            data: data as never,
          },
        }),
      );
      rowIds.push(row.id);
      rowDatas.push(data);
    }
    chunks.push({ chunkIndex, rowIds, rows: rowDatas });
  }

  // Observe the queue from the outside, as an operator would.
  const events = new QueueEvents('import', { connection: getConnection() });
  await events.waitUntilReady();

  const enqueuedAt = new Map<string, number>();
  const activeAt = new Map<string, number>();
  const queueWaits: number[] = [];
  const processingTimes: number[] = [];
  let failedJobs = 0;
  let firstWorkerStart: number | null = null;

  events.on('active', ({ jobId }) => {
    const now = Date.now();
    activeAt.set(jobId, now);
    if (firstWorkerStart === null) firstWorkerStart = now;
    const queued = enqueuedAt.get(jobId);
    if (queued !== undefined) queueWaits.push(now - queued);
  });
  events.on('completed', ({ jobId }) => {
    const started = activeAt.get(jobId);
    if (started !== undefined) processingTimes.push(Date.now() - started);
  });
  events.on('failed', () => {
    failedJobs += 1;
  });

  const worker = createImportWorker();
  await worker.waitUntilReady();

  const enqueueStartedAt = new Date();
  const startedMs = Date.now();

  for (const chunk of chunks) {
    const jobId = await enqueue(
      JobType.IMPORT_CHUNK,
      {
        batchId: batch.id,
        chunkIndex: chunk.chunkIndex,
        rowIds: chunk.rowIds,
        rows: chunk.rows,
        assignedToId: USER,
        userId: USER,
        campaignId: CAMPAIGN,
        tenantId: T,
        initialStage: 'new',
      } as never,
      { tenantId: T },
    );
    enqueuedAt.set(String(jobId), Date.now());
  }

  // Wait for every row to reach a terminal state rather than for job counts, because the
  // question is whether prospects landed, not whether jobs stopped.
  const deadline = Date.now() + 10 * 60 * 1000;
  let terminalRows = 0;
  while (Date.now() < deadline) {
    terminalRows = await run(() =>
      prisma.importRow.count({
        where: { tenantId: T, batchId: batch.id, status: { in: ['imported', 'error', 'skipped'] } },
      }),
    );
    if (terminalRows >= rows) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const lastRowTerminalAt = new Date();

  // Commit through the queue too, so the commit path is exercised over real BullMQ.
  const commitJobId = await enqueue(
    JobType.IMPORT_COMMIT,
    { batchId: batch.id } as never,
    { tenantId: T },
  );
  enqueuedAt.set(String(commitJobId), Date.now());

  let batchCommittedAt: Date | null = null;
  const commitDeadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < commitDeadline) {
    const current = await run(() =>
      prisma.importBatch.findUnique({ where: { id: batch.id }, select: { status: true } }),
    );
    if (current && current.status !== 'parsing' && current.status !== 'importing') {
      batchCommittedAt = new Date();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const totalDurationMs = Date.now() - startedMs;

  const [createdLeads, createdAccounts, createdContacts, importedRows, stuckRows, retries] =
    await Promise.all([
      run(() => prisma.lead.count({ where: { tenantId: T } })),
      run(() => prisma.account.count({ where: { tenantId: T } })),
      run(() => prisma.contact.count({ where: { tenantId: T } })),
      run(() => prisma.importRow.count({ where: { tenantId: T, status: 'imported' } })),
      run(() =>
        prisma.importRow.count({
          where: { tenantId: T, batchId: batch.id, status: { notIn: ['imported', 'error', 'skipped'] } },
        }),
      ),
      Promise.resolve(Math.max(0, activeAt.size - chunks.length - 1)),
    ]);

  await worker.close();
  await events.close();

  return {
    rows,
    chunks: chunks.length,
    totalDurationMs,
    rowsPerSecond: Math.round((rows / (totalDurationMs / 1000)) * 100) / 100,
    queueWaitMs: {
      p50: percentile(queueWaits, 0.5),
      p95: percentile(queueWaits, 0.95),
      p99: percentile(queueWaits, 0.99),
    },
    jobProcessingMs: {
      p50: percentile(processingTimes, 0.5),
      p95: percentile(processingTimes, 0.95),
      p99: percentile(processingTimes, 0.99),
    },
    enqueueStartedAt: enqueueStartedAt.toISOString(),
    firstWorkerStartAt: new Date(firstWorkerStart ?? startedMs).toISOString(),
    lastRowTerminalAt: lastRowTerminalAt.toISOString(),
    batchCommittedAt: batchCommittedAt ? batchCommittedAt.toISOString() : null,
    failedJobs,
    retries,
    lostRows: rows - importedRows,
    duplicateRows: Math.max(0, createdLeads - rows),
    stuckRows,
    workerConcurrency: concurrency,
    createdLeads,
    createdAccounts,
    createdContacts,
  };
}

async function main() {
  const candidateSha = arg('candidate', '');
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error('--candidate <40-char commit sha> is required so the evidence is bound to a candidate');
    process.exit(2);
  }
  const scales = arg('scales', '120,500,1000')
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  const { url } = getRedisConfig();
  console.log(`redis   : ${new URL(url).host}`);
  console.log(`scales  : ${scales.join(', ')}`);
  console.log('');

  const startedAt = new Date().toISOString();
  const results: ScaleResult[] = [];
  const transcript: string[] = [];

  for (const scale of scales) {
    console.log(`[${scale} rows] enqueuing real BullMQ jobs`);
    const result = await runScale(scale, 3);
    results.push(result);
    transcript.push(`## ${scale} rows\n${JSON.stringify(result, null, 2)}`);
    console.log(
      `           ${(result.totalDurationMs / 1000).toFixed(2)}s, ${result.rowsPerSecond} rows/s, ` +
        `queue wait p95 ${result.queueWaitMs.p95}ms, lost ${result.lostRows}, dup ${result.duplicateRows}`,
    );
  }

  const finishedAt = new Date().toISOString();
  const failed = results.filter((result) => result.lostRows !== 0 || result.duplicateRows !== 0);

  const repoRoot = process.cwd();
  const rawDir = path.join(repoRoot, 'docs/production-certification/evidence/raw');
  const evidenceDir = path.join(repoRoot, 'docs/production-certification/evidence');
  mkdirSync(rawDir, { recursive: true });

  const rawPath = path.join(rawDir, 'load-queue-benchmark.log');
  writeFileSync(
    rawPath,
    [
      '# IMPORT_SYSTEM_QUEUE_BENCHMARK',
      `# startedAt: ${startedAt}`,
      `# finishedAt: ${finishedAt}`,
      `# redis: ${new URL(url).host}`,
      '',
      ...transcript,
      '',
    ].join('\n'),
  );

  const scaleMap: Record<string, ScaleResult> = {};
  for (const result of results) scaleMap[String(result.rows)] = result;

  const record = {
    evidenceId: 'EV-LOAD-QUEUE',
    kind: 'load-benchmark',
    benchmark: 'IMPORT_SYSTEM_QUEUE_BENCHMARK',
    candidateSha,
    environment: `${process.platform} / node ${process.versions.node} / postgres 16 / real Redis / real BullMQ`,
    command: 'npx tsx scripts/certification/queue-load-benchmark.ts',
    startedAt,
    finishedAt,
    exitCode: failed.length === 0 ? 0 : 1,
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    metrics: {
      note: 'Real Redis, real BullMQ, real worker, real queue. Nothing mocked. Distinct from IMPORT_HANDLER_BENCHMARK, which calls the handler directly.',
      mocked: false,
      scales: scaleMap,
    },
    artifacts: [
      {
        path: 'docs/production-certification/evidence/raw/load-queue-benchmark.log',
        sizeBytes: statSync(rawPath).size,
        sha256: createHash('sha256').update(readFileSync(rawPath)).digest('hex'),
      },
    ],
  };

  writeFileSync(path.join(evidenceDir, 'EV-LOAD-QUEUE.json'), `${JSON.stringify(record, null, 2)}\n`);

  await closeAllQueues();
  await prisma.$disconnect();
  getConnection().disconnect();

  console.log('');
  console.log(`RESULT: ${record.status}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
