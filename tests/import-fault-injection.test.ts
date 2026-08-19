import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: () => Promise.resolve('j'),
  enqueueImmediate: () => Promise.resolve('j'),
  enqueueReschedule: () => Promise.resolve('j'),
  ensureJob: () => Promise.resolve('j'),
  removeJob: () => Promise.resolve(true),
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

describe.skipIf(!hasDb)('TEL-P1-001: Import Partial-Write & Fault Injection Convergence', () => {
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

  it('converges cleanly when retried after lead was created prior to crash', async () => {
    await setupBase();

    const batch = await run(() =>
      prisma.importBatch.create({ data: { tenantId: T, userId: USER, status: 'parsed', filename: 'test.csv' } })
    );

    const rowData = {
      firstName: 'Alice',
      lastName: 'Crash',
      company: 'Crash Recovery Inc',
      email: 'alice.crash@recovery.test',
    };

    const row = await run(() =>
      prisma.importRow.create({
        data: { batchId: batch.id, tenantId: T, rowIndex: 0, status: 'valid', data: rowData as never },
      })
    );

    // Simulated partial write: Lead was inserted, but importRow was not updated and crash happened
    const account = await run(() =>
      prisma.account.create({ data: { tenantId: T, name: rowData.company } })
    );
    const contact = await run(() =>
      prisma.contact.create({
        data: {
          tenantId: T,
          firstName: 'Alice',
          lastName: 'Crash',
          fullName: 'Alice Crash',
          email: rowData.email,
          normalizedEmail: rowData.email,
          company: rowData.company,
        },
      })
    );
    const lead = await run(() =>
      prisma.lead.create({
        data: {
          tenantId: T,
          campaignId: CAMPAIGN,
          contactId: contact.id,
          accountId: account.id,
          firstName: rowData.firstName,
          lastName: rowData.lastName,
          company: rowData.company,
          email: rowData.email,
          normalizedEmail: rowData.email,
          stage: 'new',
          assignedToId: USER,
        },
      })
    );

    // Verify precondition: row is still 'valid', lead exists
    expect(await run(() => prisma.lead.count({ where: { tenantId: T } }))).toBe(1);
    expect((await run(() => prisma.importRow.findUnique({ where: { id: row.id } })))?.status).toBe('valid');

    // Run handleImportChunk on retry
    const res = await run(() =>
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
    );

    expect(res.success).toBe(true);
    expect(res.created).toBe(1);
    expect(res.errors).toBe(0);

    // Invariant: Exactly 1 lead, 1 account, 1 contact, exactly 1 activity, and row is 'imported'
    expect(await run(() => prisma.lead.count({ where: { tenantId: T } }))).toBe(1);
    expect(await run(() => prisma.account.count({ where: { tenantId: T } }))).toBe(1);
    expect(await run(() => prisma.contact.count({ where: { tenantId: T } }))).toBe(1);
    expect(await run(() => prisma.activity.count({ where: { tenantId: T, type: 'lead_created' } }))).toBe(1);

    const updatedRow = await run(() => prisma.importRow.findUnique({ where: { id: row.id } }));
    expect(updatedRow?.status).toBe('imported');
    expect(updatedRow?.leadId).toBe(lead.id);
  });

  it('commit blocks while chunks are in flight (IMP-012)', async () => {
    await setupBase();

    const batch = await run(() =>
      prisma.importBatch.create({ data: { tenantId: T, userId: USER, status: 'parsing', filename: 'pending.csv' } })
    );

    // Row is still valid/in-flight
    await run(() =>
      prisma.importRow.create({
        data: { batchId: batch.id, tenantId: T, rowIndex: 0, status: 'valid', data: { email: 'a@b.com', company: 'X' } as never },
      })
    );

    const commitRes = await run(() => handleImportCommit({ batchId: batch.id }));
    expect(commitRes.success).toBe(false);
    expect(commitRes.inProgress).toBe(true);
    expect(commitRes.reason).toBe('chunks_still_in_flight');

    // Batch status is not committed
    const currentBatch = await run(() => prisma.importBatch.findUnique({ where: { id: batch.id } }));
    expect(currentBatch?.status).not.toBe('committed');
  });
});
