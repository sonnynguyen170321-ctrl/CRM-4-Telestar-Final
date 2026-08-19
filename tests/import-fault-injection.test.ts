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
const SEQUENCE = 'fault-sequence';
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

describe.skipIf(!hasDb)('TEL-P1-001 / TEL-P1-005 / TEL-P1-006 / TEL-P1-007 / TEL-P2-011: Import Hardening & Full Failpoint Matrix', () => {
  const setupBase = async () => {
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.leadgenActivity.deleteMany({ where: { tenantId: T } });
      await prisma.task.deleteMany({ where: { tenantId: T } });
      await prisma.importRow.deleteMany({ where: { tenantId: T } });
      await prisma.importBatch.deleteMany({ where: { tenantId: T } });
      await prisma.leadPoolItem.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.contact.deleteMany({ where: { tenantId: T } });
      await prisma.account.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceStep.deleteMany({ where: { sequence: { tenantId: T } } });
      await prisma.sequence.deleteMany({ where: { tenantId: T } });
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
      const seq = await prisma.sequence.create({
        data: {
          id: SEQUENCE,
          tenantId: T,
          createdById: USER,
          name: 'Fault Sequence',
        },
      });
      await prisma.sequenceStep.create({
        data: {
          tenantId: T,
          sequenceId: seq.id,
          order: 1,
          channel: 'email',
          delayDays: 0,
          instructions: 'Step 1 email outreach',
        },
      });
    });
  };

  describe('TEL-P1-006 / TEL-P2-011: Complete CRM Import Failpoint Convergence', () => {
    const crmFailpoints = [
      'after_account',
      'after_contact',
      'after_lead',
      'after_import_row',
      'after_activity_lead_created',
      'after_activity_sequence_enrolled',
      'after_task',
    ] as const;

    for (const fp of crmFailpoints) {
      it(`CRM import fails at ${fp} and converges cleanly on retry without duplicate records`, async () => {
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

        // Attempt 1: fail at boundary
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
              sequenceId: SEQUENCE,
              initialStage: 'new',
            } as never)
          )
        ).rejects.toThrow(`FAILPOINT_${fp.toUpperCase()}`);

        // Attempt 2: retry without failpoint
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
            sequenceId: SEQUENCE,
            initialStage: 'new',
          } as never)
        );

        expect(res.success).toBe(true);
        expect(res.created).toBe(1);

        // Invariants: exactly 1 lead, 1 account, 1 contact, 1 lead_created activity, 1 sequence_enrolled activity, 1 task
        expect(await run(() => prisma.lead.count({ where: { tenantId: T } }))).toBe(1);
        expect(await run(() => prisma.account.count({ where: { tenantId: T } }))).toBe(1);
        expect(await run(() => prisma.contact.count({ where: { tenantId: T } }))).toBe(1);
        expect(await run(() => prisma.activity.count({ where: { tenantId: T, type: 'lead_created' } }))).toBe(1);
        expect(await run(() => prisma.activity.count({ where: { tenantId: T, type: 'sequence_enrolled' } }))).toBe(1);
        expect(await run(() => prisma.task.count({ where: { tenantId: T } }))).toBe(1);

        const finalRow = await run(() => prisma.importRow.findUnique({ where: { id: row.id } }));
        expect(finalRow?.status).toBe('imported');
      });
    }
  });

  describe('TEL-P2-011: Complete Pool Import Failpoint Convergence', () => {
    const poolFailpoints = [
      'after_pool_item',
      'after_pool_import_row',
      'after_pool_activity',
    ] as const;

    for (const fp of poolFailpoints) {
      it(`Pool import fails at ${fp} and converges cleanly on retry`, async () => {
        await setupBase();

        const batch = await run(() =>
          prisma.importBatch.create({ data: { tenantId: T, userId: USER, status: 'parsed', filename: `pool-${fp}.csv` } })
        );

        const rowData = {
          firstName: 'Paul',
          lastName: `Pool-${fp}`,
          company: `Pool Corp ${fp}`,
          email: `paul.${fp}@pool.test`,
          __failpoint: fp,
        };

        const row = await run(() =>
          prisma.importRow.create({
            data: { batchId: batch.id, tenantId: T, rowIndex: 0, status: 'valid', data: rowData as never },
          })
        );

        // Attempt 1: fail at boundary
        await expect(
          run(() =>
            handleImportChunk({
              batchId: batch.id,
              chunkIndex: 0,
              rowIds: [row.id],
              rows: [rowData],
              assignedToId: USER,
              userId: USER,
              tenantId: T,
              targetType: 'pool',
            } as never)
          )
        ).rejects.toThrow(`FAILPOINT_${fp.toUpperCase()}`);

        // Attempt 2: retry without failpoint
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
            tenantId: T,
            targetType: 'pool',
          } as never)
        );

        expect(res.success).toBe(true);
        expect(res.created).toBe(1);

        // Invariants: exactly 1 pool item and 1 activity
        expect(await run(() => prisma.leadPoolItem.count({ where: { tenantId: T } }))).toBe(1);
        expect(await run(() => prisma.leadgenActivity.count({ where: { tenantId: T, type: 'imported' } }))).toBe(1);

        const finalRow = await run(() => prisma.importRow.findUnique({ where: { id: row.id } }));
        expect(finalRow?.status).toBe('imported');
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

      const [res1, res2] = await Promise.all([
        run(() => handleImportChunk(chunkPayload as never)),
        run(() => handleImportChunk(chunkPayload as never)),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

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

      const earlyCommit = await run(() => handleImportCommit({ batchId: batch.id }));
      expect(earlyCommit.success).toBe(false);
      expect(earlyCommit.inProgress).toBe(true);
      expect(earlyCommit.reason).toBe('chunks_still_in_flight');

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

      const finalCommit = await run(() => handleImportCommit({ batchId: batch.id }));
      expect(finalCommit.success).toBe(true);
      expect(finalCommit.imported).toBe(1);

      const committedBatch = await run(() => prisma.importBatch.findUnique({ where: { id: batch.id } }));
      expect(committedBatch?.status).toBe('committed');
      expect(committedBatch?.parsedRows).toBe(1);
    });
  });
});
