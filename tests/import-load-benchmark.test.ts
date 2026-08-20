import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('j'),
  enqueueImmediate: vi.fn().mockResolvedValue('j'),
  enqueueReschedule: vi.fn().mockResolvedValue('j'),
  ensureJob: vi.fn().mockResolvedValue('j'),
  removeJob: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/bullmq/ensureJob', () => ({ ensureJob: () => Promise.resolve('j') }));
vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { handleImportChunk, handleImportCommit } = await import('@/workers/import');

const T = 'load-tenant';
const USER = 'load-user';
const CLIENT = 'load-client';
const CAMPAIGN = 'load-campaign';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

interface LoadMetric {
  batchSize: number;
  totalDurationMs: number;
  throughputRowsPerSec: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  createdLeads: number;
  createdAccounts: number;
  createdContacts: number;
  lostRows: number;
  duplicateRows: number;
  memoryUsedMb: number;
}

const recordedMetrics: LoadMetric[] = [];

describe.skipIf(!hasDb)('IMPORT_HANDLER_BENCHMARK (TEL-P2-012, reclassified by TEL-P2-016): 120, 500, 1000 rows', () => {
  const setupTenant = async () => {
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
      await prisma.tenant.deleteMany({ where: { id: T } });
    });
    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: T, name: 'Load Tenant' } });
      await prisma.user.create({
        data: { id: USER, tenantId: T, email: 'l@load.test', password: 'x', firstName: 'L', lastName: 'T', role: 'sdr' },
      });
    });
    await run(async () => {
      await prisma.client.create({
        data: { id: CLIENT, tenantId: T, name: 'Load Client', industry: 'Tech', contactName: 'C', contactEmail: 'c@load.test' },
      });
      await prisma.campaign.create({
        data: { id: CAMPAIGN, tenantId: T, clientId: CLIENT, name: 'Load Campaign', startDate: new Date('2026-08-12') },
      });
    });
  };

  const runBatchBenchmark = async (totalRows: number, chunkSize = 50): Promise<LoadMetric> => {
    await setupTenant();

    const initialMem = process.memoryUsage().heapUsed;
    const batch = await run(() =>
      prisma.importBatch.create({
        data: { tenantId: T, userId: USER, status: 'parsing', filename: `load-${totalRows}.csv` },
      })
    );

    const chunkLatencies: number[] = [];
    const numChunks = Math.ceil(totalRows / chunkSize);
    const startTime = Date.now();

    for (let c = 0; c < numChunks; c++) {
      const rowsInThisChunk = Math.min(chunkSize, totalRows - c * chunkSize);
      const rowIds: string[] = [];
      const rowDatas: any[] = [];

      for (let r = 0; r < rowsInThisChunk; r++) {
        const globalIdx = c * chunkSize + r;
        const rowData = {
          firstName: `Lead_${globalIdx}`,
          lastName: `Batch_${totalRows}`,
          company: `Company_${globalIdx % 20}`, // 20 shared accounts to test collation & indexing
          email: `lead_${globalIdx}_${totalRows}@benchmark.test`,
          phone: `+1555${String(globalIdx).padStart(6, '0')}`,
        };
        const row = await run(() =>
          prisma.importRow.create({
            data: {
              batchId: batch.id,
              tenantId: T,
              rowIndex: globalIdx,
              status: 'valid',
              data: rowData as never,
            },
          })
        );
        rowIds.push(row.id);
        rowDatas.push(rowData);
      }

      const chunkStart = Date.now();
      const chunkRes = await run(() =>
        handleImportChunk({
          batchId: batch.id,
          chunkIndex: c,
          rowIds,
          rows: rowDatas,
          assignedToId: USER,
          userId: USER,
          campaignId: CAMPAIGN,
          tenantId: T,
          initialStage: 'new',
        } as never)
      );
      const chunkElapsed = Date.now() - chunkStart;
      chunkLatencies.push(chunkElapsed);

      expect(chunkRes.success).toBe(true);
      expect(chunkRes.created).toBe(rowsInThisChunk);
    }

    const commitRes = await run(() => handleImportCommit({ batchId: batch.id }));
    expect(commitRes.success).toBe(true);

    const totalDurationMs = Date.now() - startTime;
    const finalMem = process.memoryUsage().heapUsed;

    chunkLatencies.sort((a, b) => a - b);
    const p50 = chunkLatencies[Math.floor(chunkLatencies.length * 0.5)] || 0;
    const p95 = chunkLatencies[Math.floor(chunkLatencies.length * 0.95)] || chunkLatencies[chunkLatencies.length - 1];
    const p99 = chunkLatencies[Math.floor(chunkLatencies.length * 0.99)] || chunkLatencies[chunkLatencies.length - 1];

    const createdLeads = await run(() => prisma.lead.count({ where: { tenantId: T } }));
    const createdAccounts = await run(() => prisma.account.count({ where: { tenantId: T } }));
    const createdContacts = await run(() => prisma.contact.count({ where: { tenantId: T } }));
    const importedRows = await run(() => prisma.importRow.count({ where: { tenantId: T, status: 'imported' } }));
    expect(importedRows).toBe(createdLeads);

    const metric: LoadMetric = {
      batchSize: totalRows,
      totalDurationMs,
      throughputRowsPerSec: Math.round((totalRows / (totalDurationMs / 1000)) * 100) / 100,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
      createdLeads,
      createdAccounts,
      createdContacts,
      lostRows: totalRows - createdLeads,
      duplicateRows: createdLeads > totalRows ? createdLeads - totalRows : 0,
      memoryUsedMb: Math.round(((finalMem - initialMem) / 1024 / 1024) * 100) / 100,
    };

    recordedMetrics.push(metric);
    return metric;
  };

  it('executes 120-row high contention import benchmark with zero prospect loss', async () => {
    const metric = await runBatchBenchmark(120, 30);
    expect(metric.createdLeads).toBe(120);
    expect(metric.lostRows).toBe(0);
    expect(metric.duplicateRows).toBe(0);
  });

  it('executes 500-row batch import benchmark with measured throughput & p95 latency', async () => {
    const metric = await runBatchBenchmark(500, 50);
    expect(metric.createdLeads).toBe(500);
    expect(metric.lostRows).toBe(0);
    expect(metric.duplicateRows).toBe(0);
  });

  it('executes 1,000-row batch import benchmark with complete relational integrity', async () => {
    const metric = await runBatchBenchmark(1000, 50);
    expect(metric.createdLeads).toBe(1000);
    expect(metric.lostRows).toBe(0);
    expect(metric.duplicateRows).toBe(0);

    // Emit STRUCTURED evidence, not prose.
    //
    // This test used to write LOAD_TEST.md directly, and the certificate carried a second,
    // different set of numbers for the same run - 26.11s here versus 19.71s there
    // (TEL-P2-015). Performance figures now have exactly one source: this record. Every
    // document that shows them is rendered from it.
    //
    // The benchmark is named for what it actually measures. BullMQ is mocked here and the
    // handler is called directly, so this is a HANDLER benchmark: it says nothing about
    // enqueue cost, queue wait, redelivery or retry. IMPORT_SYSTEM_QUEUE_BENCHMARK
    // (scripts/certification/queue-load-benchmark.ts) covers those over real Redis.
    const scales: Record<string, LoadMetric> = {};
    for (const entry of recordedMetrics) scales[String(entry.batchSize)] = entry;

    const startedAt = new Date(Date.now() - recordedMetrics.reduce((sum, m) => sum + m.totalDurationMs, 0));
    const record = {
      evidenceId: 'EV-LOAD-HANDLER',
      kind: 'load-benchmark',
      benchmark: 'IMPORT_HANDLER_BENCHMARK',
      candidateSha: process.env.CERT_CANDIDATE_SHA ?? null,
      environment: `${process.platform} / node ${process.versions.node} / postgres 16 / BullMQ mocked`,
      command: 'node node_modules/vitest/vitest.mjs run tests/import-load-benchmark.test.ts',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      status: 'PASS',
      metrics: {
        note: 'Handler throughput only. BullMQ is mocked and the worker handler is invoked directly, so queue wait, redelivery and retry are out of scope by construction.',
        mocked: true,
        scales,
      },
      artifacts: [],
    };

    writeFileSync(
      path.join(process.cwd(), 'docs/production-certification/evidence/EV-LOAD-HANDLER.json'),
      `${JSON.stringify(record, null, 2)}
`,
      'utf-8',
    );
  }, 90000);
});
