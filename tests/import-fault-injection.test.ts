import { describe, it, expect, vi } from 'vitest';

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

const T = 'fault-tenant';
const USER = 'fault-user';
const CLIENT = 'fault-client';
const CAMPAIGN = 'fault-campaign';
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

describe.skipIf(!hasDb)('TEL-P1-001 / TEL-P1-005 / TEL-P1-006 / TEL-P1-007: Import Hardening Suite', () => {
  const setupBase = async () => {
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
      await prisma.tenant.create({ data: { id: T, name: 'Fault Tenant' } });
      await prisma.user.create({
        data: { id: USER, tenantId: T, email: 'f@fault.test', password: 'x', firstName: 'F', lastName: 'T', role: 'sdr' },
      });
    });
    await run(async () => {
      await prisma.client.create({
        data: { id: CLIENT, tenantId: T, name: 'Fault Client', industry: 'Tech', contactName: 'C', contactEmail: 'c@fault.test' },
      });
      await prisma.campaign.create({
        data: { id: CAMPAIGN, tenantId: T, clientId: CLIENT, name: 'Fault Campaign', startDate: new Date('2026-08-12') },
      });
    });
  };

  describe('TEL-P1-006: Deterministic Failpoints and True Convergence', () => {
    const failpoints = [
      'after_account',
      'after_contact',
      'after_lead',
      'after_import_row',
      'after_activity_lead_created',
    ] as const;

    for (const fp of failpoints) {
      it(`fails at failpoint ${fp} and converges cleanly upon retry without duplicate records`, async () => {
        await setupBase();

        const batch = await run(() =>
          prisma.importBatch.create({ data: { tenantId: T, userId: USER, status: 'parsed', filename: `test-${fp}.csv` } })
        );

        const rowData = {
          firstName: 'Bob',
          lastName: `Crash-${fp}`,
          company: `Crash Corp ${fp}`,
          email: `bob.${fp}@crash.test`,
          __failpoint: fp,
        };

        const row = await run(() =>
          prisma.importRow.create({
            data: { batchId: batch.id, tenantId: T, rowIndex: 0, status: 'valid', data: rowData as never },
          })
        );

        // First attempt: should throw the deterministic crash error at the exact boundary
        await expect(
          run(() =>
            handleImportChunk({
              batchId: batch.id,
              chunkIndex: 0,
              rowIds: [row.id],
              rows: [rowData],
              assignedToId: USER,
              userId: USER,
              campaignId: CAMPAIGN,
              tenantId: T,
              initialStage: 'new',
            } as never)
          )
        ).rejects.toThrow(`FAILPOINT_${fp.toUpperCase()}`);

        // Second attempt: retry without failpoint
        const retryRowData = { ...rowData, __failpoint: undefined };
        await run(() =>
          prisma.importRow.update({
            where: { id: row.id },
            data: { data: retryRowData as never },
          })
        );

        const res = await run(() =>
          handleImportChunk({
            batchId: batch.id,
            chunkIndex: 0,
            rowIds: [row.id],
            rows: [retryRowData],
            assignedToId: USER,
            userId: USER,
            campaignId: CAMPAIGN,
            tenantId: T,
            initialStage: 'new',
          } as never)
        );

        expect(res.success).toBe(true);
        expect(res.created).toBe(1);
        expect(res.errors).toBe(0);

        // Assert convergence invariants
        expect(await run(() => prisma.lead.count({ where: { tenantId: T } }))).toBe(1);
        expect(await run(() => prisma.account.count({ where: { tenantId: T } }))).toBe(1);
        expect(await run(() => prisma.contact.count({ where: { tenantId: T } }))).toBe(1);
        expect(await run(() => prisma.activity.count({ where: { tenantId: T, type: 'lead_created' } }))).toBe(1);

        const finalRow = await run(() => prisma.importRow.findUnique({ where: { id: row.id } }));
        expect(finalRow?.status).toBe('imported');
        expect(finalRow?.leadId).toBeTruthy();
      });
    }
  });

  describe('TEL-P1-007: Concurrent Duplicate Job Delivery', () => {
    it('executes identical chunk payload concurrently across 2 workers without duplicating leads or activities', async () => {
      await setupBase();

      const batch = await run(() =>
        prisma.importBatch.create({ data: { tenantId: T, userId: USER, status: 'parsed', filename: 'race.csv' } })
      );

      const rowData = {
        firstName: 'Charlie',
        lastName: 'Concurrent',
        company: 'Concurrency Inc',
        email: 'charlie.concurrent@race.test',
      };

      const row = await run(() =>
        prisma.importRow.create({
          data: { batchId: batch.id, tenantId: T, rowIndex: 0, status: 'valid', data: rowData as never },
        })
      );

      const chunkPayload = {
        batchId: batch.id,
        chunkIndex: 0,
        rowIds: [row.id],
        rows: [rowData],
        assignedToId: USER,
        userId: USER,
        campaignId: CAMPAIGN,
        tenantId: T,
        initialStage: 'new',
      };

      // Execute duplicate job delivery simultaneously
      const [res1, res2] = await Promise.all([
        run(() => handleImportChunk(chunkPayload as never)),
        run(() => handleImportChunk(chunkPayload as never)),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      // Invariants: exactly 1 of each entity created
      expect(await run(() => prisma.lead.count({ where: { tenantId: T } }))).toBe(1);
      expect(await run(() => prisma.account.count({ where: { tenantId: T } }))).toBe(1);
      expect(await run(() => prisma.contact.count({ where: { tenantId: T } }))).toBe(1);
      expect(await run(() => prisma.activity.count({ where: { tenantId: T, type: 'lead_created' } }))).toBe(1);

      const finalRow = await run(() => prisma.importRow.findUnique({ where: { id: row.id } }));
      expect(finalRow?.status).toBe('imported');
    });
  });

  describe('TEL-P1-005: Eventual Batch Commit Completion', () => {
    it('commit re-enqueues when chunks are in flight, then commits when chunks complete', async () => {
      await setupBase();

      const batch = await run(() =>
        prisma.importBatch.create({ data: { tenantId: T, userId: USER, status: 'parsing', filename: 'eventual.csv' } })
      );

      const row = await run(() =>
        prisma.importRow.create({
          data: {
            batchId: batch.id,
            tenantId: T,
            rowIndex: 0,
            status: 'valid',
            data: { firstName: 'Dave', lastName: 'Commit', company: 'Commit LLC', email: 'dave@commit.test' } as never,
          },
        })
      );

      // Early commit attempt while row is 'valid'
      const earlyCommit = await run(() => handleImportCommit({ batchId: batch.id }));
      expect(earlyCommit.success).toBe(false);
      expect(earlyCommit.inProgress).toBe(true);
      expect(earlyCommit.reason).toBe('chunks_still_in_flight');

      // Now process the chunk
      await run(() =>
        handleImportChunk({
          batchId: batch.id,
          chunkIndex: 0,
          rowIds: [row.id],
          rows: [{ firstName: 'Dave', lastName: 'Commit', company: 'Commit LLC', email: 'dave@commit.test' }],
          assignedToId: USER,
          userId: USER,
          campaignId: CAMPAIGN,
          tenantId: T,
          initialStage: 'new',
        } as never)
      );

      // Subsequent commit attempt
      const finalCommit = await run(() => handleImportCommit({ batchId: batch.id }));
      expect(finalCommit.success).toBe(true);
      expect(finalCommit.imported).toBe(1);

      const committedBatch = await run(() => prisma.importBatch.findUnique({ where: { id: batch.id } }));
      expect(committedBatch?.status).toBe('committed');
      expect(committedBatch?.parsedRows).toBe(1);
    });
  });
});
