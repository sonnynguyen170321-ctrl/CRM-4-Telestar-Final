import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * Import data integrity against a real Postgres.
 *
 * Three behaviours lost their coverage in `934bf05`, which replaced a mocked
 * `tests/import-worker.test.ts` section wholesale:
 *
 *   - concurrent identical accounts converge on one durable account;
 *   - concurrent identical contacts converge on one durable contact;
 *   - a blank field in a later import does not erase what an earlier one established.
 *
 * They are rebuilt here against the real database rather than restored as mocks, because the
 * first two are *only* true or false under real concurrency: a mocked `$transaction` runs the
 * callback inline on one fake client, so find-then-create can never lose the race that the
 * production code actually runs. A mock asserting convergence would pass on code that drops
 * every colliding row.
 *
 * The queue is the only substitution — `handleImportChunk` is invoked directly, which is what
 * the worker does with the payload BullMQ hands it.
 */

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: () => Promise.resolve('job-1'),
  enqueueImmediate: () => Promise.resolve('job-1'),
  enqueueReschedule: () => Promise.resolve('job-1'),
  ensureJob: () => Promise.resolve('job-1'),
  removeJob: () => Promise.resolve(true),
}));
vi.mock('@/lib/bullmq/ensureJob', () => ({ ensureJob: () => Promise.resolve('job-1') }));
vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { handleImportChunk } = await import('@/workers/import');

const hasDb = Boolean(process.env.DATABASE_URL);

const T = 'import-concurrency-tenant';
const USER = 'import-concurrency-user';
const CLIENT = 'import-concurrency-client';
const CAMPAIGN = 'import-concurrency-campaign';

const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

async function reset() {
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
    await prisma.tenant.create({ data: { id: T, name: 'Import Concurrency' } });
    await prisma.user.create({
      data: {
        id: USER,
        tenantId: T,
        email: 'importer@concurrency.test',
        password: 'x',
        firstName: 'Ivy',
        lastName: 'Porter',
        role: 'sdr',
      },
    });
  });
  // A lead always belongs to a campaign (`lead -> campaign -> client`), and the worker writes
  // `campaignId: campaignId!` — so an import with no campaign is not a scenario worth testing.
  await run(async () => {
    await prisma.client.create({
      data: {
        id: CLIENT,
        tenantId: T,
        name: 'Concurrency Client',
        industry: 'Logistics',
        contactName: 'Ops',
        contactEmail: 'ops@concurrency.test',
      },
    });
    await prisma.campaign.create({
      data: {
        id: CAMPAIGN,
        tenantId: T,
        clientId: CLIENT,
        name: 'Concurrency Campaign',
        startDate: new Date('2026-08-12T00:00:00Z'),
      },
    });
  });
}

/** One import row, ready for a chunk. `data` is the shape the parser produces. */
async function seedRow(batchId: string, rowIndex: number, data: Record<string, unknown>) {
  return run(() =>
    prisma.importRow.create({
      data: { batchId, tenantId: T, rowIndex, status: 'valid', data: data as never },
    })
  );
}

async function seedBatch() {
  return run(() =>
    prisma.importBatch.create({
      data: { tenantId: T, userId: USER, status: 'parsed', filename: 'concurrency.csv' },
    })
  );
}

const chunk = (batchId: string, chunkIndex: number, rowIds: string[], rows: Record<string, unknown>[]) => ({
  batchId,
  chunkIndex,
  rowIds,
  rows,
  assignedToId: USER,
  userId: USER,
  campaignId: CAMPAIGN,
  tenantId: T,
  initialStage: 'new',
});

describe.skipIf(!hasDb)('import chunks that collide on the same identity', () => {
  beforeEach(reset);
  afterAll(reset);

  it('two concurrent chunks importing the same company converge on one account, losing no lead', async () => {
    const batch = await seedBatch();

    // Same tenant, same company name — the `Account_tenantId_name_key` identity — but two
    // different people, so each row is a legitimate lead that must survive.
    const a = { firstName: 'Ilse', lastName: 'Bakker', company: 'Rotterdam Freight', email: 'ilse@rotterdamfreight.test' };
    const b = { firstName: 'Joop', lastName: 'Visser', company: 'Rotterdam Freight', email: 'joop@rotterdamfreight.test' };

    const rowA = await seedRow(batch.id, 0, a);
    const rowB = await seedRow(batch.id, 1, b);

    // Two chunks in flight at once, which is exactly what the worker's concurrency produces
    // for one large file. Sequentially this always passes; the race only exists in parallel.
    const [resA, resB] = await run(() =>
      Promise.all([
        handleImportChunk(chunk(batch.id, 0, [rowA.id], [a]) as never),
        handleImportChunk(chunk(batch.id, 1, [rowB.id], [b]) as never),
      ])
    );

    // Neither chunk may report an error: a unique-constraint collision on a *shared* account is
    // an expected outcome of concurrent import, not a bad row.
    expect((resA as { errors: number }).errors).toBe(0);
    expect((resB as { errors: number }).errors).toBe(0);

    const accounts = await run(() =>
      prisma.account.findMany({ where: { tenantId: T, name: 'Rotterdam Freight' } })
    );
    expect(accounts).toHaveLength(1);

    // Both leads exist and both point at that one durable account.
    const leads = await run(() => prisma.lead.findMany({ where: { tenantId: T }, orderBy: { email: 'asc' } }));
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.accountId === accounts[0].id)).toBe(true);

    const rows = await run(() => prisma.importRow.findMany({ where: { batchId: batch.id } }));
    expect(rows.filter((r) => r.status === 'error')).toHaveLength(0);
  });

  it('two concurrent chunks importing the same contact converge on one contact, losing no lead', async () => {
    const batch = await seedBatch();

    // Same normalized email — the `Contact_tenantId_normalizedEmail_key` identity. The second
    // lead is forced so the test is about contact convergence rather than lead deduplication.
    const a = { firstName: 'Ilse', lastName: 'Bakker', company: 'Rotterdam Freight', email: 'ilse@rotterdamfreight.test' };
    const b = { firstName: 'Ilse', lastName: 'Bakker', company: 'Amsterdam Freight', email: 'ILSE@RotterdamFreight.test', forceDuplicateLead: true };

    const rowA = await seedRow(batch.id, 0, a);
    const rowB = await seedRow(batch.id, 1, b);

    const [resA, resB] = await run(() =>
      Promise.all([
        handleImportChunk(chunk(batch.id, 0, [rowA.id], [a]) as never),
        handleImportChunk(chunk(batch.id, 1, [rowB.id], [b]) as never),
      ])
    );

    expect((resA as { errors: number }).errors).toBe(0);
    expect((resB as { errors: number }).errors).toBe(0);

    const contacts = await run(() => prisma.contact.findMany({ where: { tenantId: T } }));
    expect(contacts).toHaveLength(1);

    const leads = await run(() => prisma.lead.findMany({ where: { tenantId: T } }));
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.contactId === contacts[0].id)).toBe(true);
  });
});

describe.skipIf(!hasDb)('a later import never erases what an earlier one established', () => {
  beforeEach(reset);
  afterAll(reset);

  it('a blank incoming field leaves the known value in place', async () => {
    const batch = await seedBatch();

    const known = {
      firstName: 'Ilse',
      lastName: 'Bakker',
      company: 'Rotterdam Freight',
      title: 'Head of Logistics',
      phone: '+31 10 555 0100',
      email: 'ilse@rotterdamfreight.test',
      industry: 'Logistics',
    };
    const rowA = await seedRow(batch.id, 0, known);
    await run(() => handleImportChunk(chunk(batch.id, 0, [rowA.id], [known]) as never));

    // The same person arrives again from a thinner list: title, phone and industry are blank,
    // and one of them is an empty string rather than absent — a CSV produces both.
    const thin = {
      firstName: 'Ilse',
      lastName: 'Bakker',
      company: 'Rotterdam Freight',
      title: '',
      phone: '',
      email: 'ilse@rotterdamfreight.test',
      industry: '',
      forceDuplicateLead: true,
    };
    const rowB = await seedRow(batch.id, 1, thin);
    await run(() => handleImportChunk(chunk(batch.id, 1, [rowB.id], [thin]) as never));

    const contact = await run(() => prisma.contact.findFirst({ where: { tenantId: T } }));
    expect(contact?.title).toBe('Head of Logistics');
    expect(contact?.phone).toBe('+31 10 555 0100');

    const account = await run(() => prisma.account.findFirst({ where: { tenantId: T, name: 'Rotterdam Freight' } }));
    expect(account?.industry).toBe('Logistics');
  });

  it('a populated incoming field still fills a gap the first import left empty', async () => {
    // The other half: preservation must not mean "ignore every later import".
    const batch = await seedBatch();

    const thin = { firstName: 'Ilse', lastName: 'Bakker', company: 'Rotterdam Freight', email: 'ilse@rotterdamfreight.test' };
    const rowA = await seedRow(batch.id, 0, thin);
    await run(() => handleImportChunk(chunk(batch.id, 0, [rowA.id], [thin]) as never));

    const richer = { ...thin, title: 'Head of Logistics', industry: 'Logistics', forceDuplicateLead: true };
    const rowB = await seedRow(batch.id, 1, richer);
    await run(() => handleImportChunk(chunk(batch.id, 1, [rowB.id], [richer]) as never));

    const contact = await run(() => prisma.contact.findFirst({ where: { tenantId: T } }));
    expect(contact?.title).toBe('Head of Logistics');

    const account = await run(() => prisma.account.findFirst({ where: { tenantId: T, name: 'Rotterdam Freight' } }));
    expect(account?.industry).toBe('Logistics');
  });
});
