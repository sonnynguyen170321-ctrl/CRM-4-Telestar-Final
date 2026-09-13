import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ImportParsePayload, ImportChunkPayload } from '@/lib/bullmq/types';

// --- Prisma mocks ---
const mockBatchFindUnique = vi.fn();
const mockBatchUpdate = vi.fn();
const mockRowFindMany = vi.fn();
const mockRowUpdate = vi.fn();
const mockRowUpdateMany = vi.fn();
const mockRowCount = vi.fn();
const mockLeadFindMany = vi.fn();
const mockLeadFindUnique = vi.fn();
const mockLeadCreate = vi.fn();
const mockLeadUpdate = vi.fn();
const mockActivityCreate = vi.fn();
const mockSequenceFindUnique = vi.fn();
const mockContactFindUnique = vi.fn();
const mockContactCreate = vi.fn();
const mockContactUpdate = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockAccountCreate = vi.fn();
const mockAccountUpdate = vi.fn();
// Account and contact are resolved on the bare client, before the transaction opens — Prisma
// does not take Postgres's native `INSERT ... ON CONFLICT DO UPDATE` path through an
// interactive transaction's `tx`. These belong on `prisma`, not inside `$transaction`.
const mockAccountUpsert = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockContactFindFirst = vi.fn();
const mockContactEmploymentUpsert = vi.fn();
const mockContactUpsert = vi.fn();
const mockRowCreate = vi.fn();
const mockRowCreateMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (fn: any) => fn({
      lead: {
        findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
        create: (...args: unknown[]) => mockLeadCreate(...args),
        update: (...args: unknown[]) => mockLeadUpdate(...args),
      },
      activity: {
        create: (...args: unknown[]) => mockActivityCreate(...args),
      },
      importRow: {
        update: (...args: unknown[]) => mockRowUpdate(...args),
      },
    }),
    importBatch: {
      findUnique: (...args: unknown[]) => mockBatchFindUnique(...args),
      update: (...args: unknown[]) => mockBatchUpdate(...args),
    },
    importRow: {
      findMany: (...args: unknown[]) => mockRowFindMany(...args),
      update: (...args: unknown[]) => mockRowUpdate(...args),
      updateMany: (...args: unknown[]) => mockRowUpdateMany(...args),
      count: (...args: unknown[]) => mockRowCount(...args),
      create: (...args: unknown[]) => mockRowCreate(...args),
      createMany: (...args: unknown[]) => mockRowCreateMany(...args),
    },
    lead: {
      findMany: (...args: unknown[]) => mockLeadFindMany(...args),
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
      findFirst: (...args: unknown[]) => mockLeadFindUnique(...args),
      create: (...args: unknown[]) => mockLeadCreate(...args),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
    activity: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    task: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'task-1' }),
    },
    sequence: {
      findUnique: (...args: unknown[]) => mockSequenceFindUnique(...args),
    },
    contact: {
      findUnique: (...args: unknown[]) => mockContactFindUnique(...args),
      findFirst: (...args: unknown[]) => mockContactFindFirst(...args),
      create: (...args: unknown[]) => mockContactCreate(...args),
      update: (...args: unknown[]) => mockContactUpdate(...args),
      upsert: (...args: unknown[]) => mockContactUpsert(...args),
    },
    contactEmployment: {
      upsert: (...args: unknown[]) => mockContactEmploymentUpsert(...args),
    },
    account: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
      findFirst: (...args: unknown[]) => mockAccountFindFirst(...args),
      create: (...args: unknown[]) => mockAccountCreate(...args),
      update: (...args: unknown[]) => mockAccountUpdate(...args),
      upsert: (...args: unknown[]) => mockAccountUpsert(...args),
    },
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('mock-job-id'),
}));

vi.mock('@/lib/sequences/engine', () => ({
  createTaskForStep: vi.fn().mockResolvedValue({ id: 'task-1' }),
}));

vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: {
    run: (_: unknown, fn: () => unknown) => fn(),
  },
}));

const { handleImportParse, handleImportChunk, handleImportCommit } = await import('@/workers/import');
const { enqueue } = await import('@/lib/bullmq/enqueue');
const { createTaskForStep } = await import('@/lib/sequences/engine');

const BASE_PARSE_PAYLOAD: ImportParsePayload = {
  batchId: 'batch-1',
  assignedToId: 'user-assign',
  campaignId: 'campaign-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  initialStage: 'new',
};

const MOCK_BATCH = {
  id: 'batch-1',
  campaignId: 'campaign-1',
  userId: 'user-1',
  filename: 'test.csv',
  totalRows: 0,
  parsedRows: 0,
  errorRows: 0,
  status: 'pending',
  tenantId: 'tenant-1',
};

function makeRow(id: string, rowIndex: number, data: Record<string, unknown>) {
  return { id, batchId: 'batch-1', rowIndex, data, status: 'pending', errors: null, leadId: null, tenantId: 'tenant-1' };
}

describe('handleImportParse', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skips if batch not found', async () => {
    mockBatchFindUnique.mockResolvedValue(null);
    const result = await handleImportParse(BASE_PARSE_PAYLOAD);
    expect(result).toEqual({ skipped: true, reason: 'batch_not_found' });
  });

  it('validates rows and marks missing name+email as error', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'John', lastName: 'Doe', company: 'Acme', email: 'john@test.com' }),
      makeRow('row-2', 2, { firstName: '', lastName: '', email: '' }),
    ]);
    mockLeadFindMany.mockResolvedValue([]);

    const result = await handleImportParse(BASE_PARSE_PAYLOAD);

    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'batch-1' }, data: { status: 'parsing' } })
    );
    expect(mockRowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-2' }, data: expect.objectContaining({ status: 'error' }) })
    );
    expect(result.success).toBe(true);
    expect(result.validationErrors).toBe(1);
  });

  it('detects duplicates by email (scoped dedup)', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'Jane', lastName: 'Doe', company: 'Acme', email: 'jane@test.com' }),
    ]);
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', email: 'jane@test.com', firstName: 'Jane', lastName: 'Doe', company: 'Acme', phone: null, title: null },
    ]);
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-1',
      email: 'jane@test.com',
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Acme',
      phone: null,
      title: null,
      contactId: null,
      accountId: null,
      contact: null,
      account: null,
    });

    const result = await handleImportParse(BASE_PARSE_PAYLOAD);

    expect(result.duplicates).toBe(1);
    expect(result.cleanRows).toBe(0);
    expect(mockRowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-1' }, data: expect.objectContaining({ status: 'error' }) })
    );
  });

  it('detects duplicates by name+company', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'Bob', lastName: 'Smith', company: 'Corp', email: 'bob@test.com' }),
    ]);
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', email: 'bob@old.com', firstName: 'Bob', lastName: 'Smith', company: 'Corp', phone: null, title: null },
    ]);

    const result = await handleImportParse(BASE_PARSE_PAYLOAD);

    expect(result.duplicates).toBe(1);
  });

  it('detects duplicates by phone', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'Alice', lastName: 'Jones', company: 'Inc', email: 'alice@test.com', phone: '555-0100' }),
    ]);
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', email: 'alice@old.com', firstName: 'Alice', lastName: 'Jones', company: 'Inc', phone: '5550100', title: null },
    ]);

    const result = await handleImportParse(BASE_PARSE_PAYLOAD);

    expect(result.duplicates).toBe(1);
  });

  it('allows duplicate when resolution is "import"', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'Jane', lastName: 'Doe', company: 'Acme', email: 'jane@test.com' }),
    ]);
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', email: 'jane@test.com', firstName: 'Jane', lastName: 'Doe', company: 'Acme', phone: null, title: null },
    ]);

    const result = await handleImportParse({
      ...BASE_PARSE_PAYLOAD,
      defaultResolution: 'import',
    });

    expect(result.duplicates).toBe(0);
    expect(result.cleanRows).toBe(1);
  });

  it('updates existing lead when resolution is "update"', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'Jane', lastName: 'Doe', company: 'Acme', email: 'jane@test.com', title: 'Engineer', phone: '555-0100' }),
    ]);
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', email: 'jane@test.com', firstName: 'Jane', lastName: 'Doe', company: 'Acme', phone: null, title: null },
    ]);

    const result = await handleImportParse({
      ...BASE_PARSE_PAYLOAD,
      defaultResolution: 'update',
    });

    expect(result.updated).toBe(1);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1' } })
    );
  });

  it('detects in-batch duplicates', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'John', lastName: 'Doe', company: 'Acme', email: 'john@test.com' }),
      makeRow('row-2', 2, { firstName: 'John', lastName: 'Doe', company: 'Acme', email: 'john@test.com' }),
    ]);
    mockLeadFindMany.mockResolvedValue([]);

    const result = await handleImportParse(BASE_PARSE_PAYLOAD);

    expect(result.duplicates).toBe(1);
    expect(result.cleanRows).toBe(1);
  });

  it('enqueues chunk jobs for clean rows', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeRow(`row-${i + 1}`, i + 1, { firstName: `F${i}`, lastName: `L${i}`, company: 'Acme', email: `f${i}@test.com` })
    );
    mockRowFindMany.mockResolvedValue(rows);
    mockLeadFindMany.mockResolvedValue([]);

    await handleImportParse(BASE_PARSE_PAYLOAD);

    expect(enqueue).toHaveBeenCalledWith(
      expect.stringContaining('import.chunk'),
      expect.objectContaining({ batchId: 'batch-1' }),
      expect.any(Object)
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.stringContaining('import.commit'),
      expect.objectContaining({ batchId: 'batch-1' }),
      expect.any(Object)
    );
  });

  it('updates batch status to parsed', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowFindMany.mockResolvedValue([]);
    mockLeadFindMany.mockResolvedValue([]);

    await handleImportParse(BASE_PARSE_PAYLOAD);

    expect(mockBatchUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'batch-1' }, data: expect.objectContaining({ status: 'parsed' }) })
    );
  });
});

describe('handleImportChunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountFindFirst.mockResolvedValue(null);
    mockContactFindFirst.mockResolvedValue(null);
    mockContactEmploymentUpsert.mockResolvedValue({ id: 'emp-1' });
    mockAccountFindUnique.mockResolvedValue({ id: 'account-1', name: 'Acme', tenantId: 't1' });
    mockAccountCreate.mockResolvedValue({ id: 'account-1', name: 'Acme', tenantId: 't1' });
    mockAccountUpdate.mockResolvedValue({ id: 'account-1', name: 'Acme', tenantId: 't1' });
    mockContactFindUnique.mockResolvedValue(null);
    mockContactCreate.mockResolvedValue({ id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@test.com', tenantId: 't1' });
    mockContactUpdate.mockResolvedValue({ id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@test.com', tenantId: 't1' });
    mockAccountUpsert.mockResolvedValue({ id: 'account-1', name: 'Acme', tenantId: 't1' });
    mockContactUpsert.mockResolvedValue({ id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@test.com', tenantId: 't1' });
  });

  const CHUNK_PAYLOAD: ImportChunkPayload = {
    batchId: 'batch-1',
    chunkIndex: 0,
    rowIds: ['row-1'],
    rows: [{ firstName: 'John', lastName: 'Doe', email: 'john@test.com', company: 'Acme', phone: '555-0100' }],
    assignedToId: 'user-assign',
    userId: 'user-1',
    campaignId: 'campaign-1',
    tenantId: 'tenant-1',
    initialStage: 'new',
  };

  /** The row fixture every chunk test needs before `handleImportChunk` will do any work. */
  const seedOneRow = () => {
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'John', lastName: 'Doe', email: 'john@test.com', company: 'Acme', phone: '555-0100' }),
    ]);
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });
  };

  it('converges on the winning account when two chunks race the same company', async () => {
    // What matters is the OUTCOME, not the statement used to reach it. Identity resolution now looks
    // a company up by its normalised name and domain, which `upsert` on `tenantId_name` cannot
    // express, so convergence is achieved by letting the unique index decide: create, and on a
    // conflict adopt the row the other chunk just wrote.
    //
    // This is the assertion that `934bf05` needed and did not have — it reverted the convergence
    // guarantee with nothing failing. Asserting the result rather than the call survives the next
    // refactor too.
    seedOneRow();
    // Every lookup misses — that is what makes this chunk decide to create — and the create then
    // loses to the other chunk. Only after that does a lookup find the winner. Driving it by a flag
    // rather than queued `*Once` values keeps the ordering explicit and leaves nothing queued for
    // the next test, which `vi.clearAllMocks()` would not clear.
    let accountExists = false;
    mockAccountFindFirst.mockImplementation(async () =>
      accountExists ? { id: 'account-winner', nameNormalized: 'acme', canonicalDomain: null } : null
    );
    mockAccountCreate.mockImplementation(async () => {
      accountExists = true;
      throw Object.assign(new Error('duplicate key'), { code: 'P2002' });
    });

    const result = await handleImportChunk(CHUNK_PAYLOAD);

    expect(result.errors).toBe(0);
    expect(result.created).toBe(1);
    expect(mockLeadCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: 'account-winner' }) })
    );
  });

  it('never lets a blank incoming field null out a value another row already set', async () => {
    // Enrichment of an EXISTING row is where this can go wrong: a create may carry explicit nulls
    // because it is establishing the row, but an update must not — every key it contains overwrites
    // whatever an earlier import already established.
    seedOneRow();
    mockAccountFindFirst.mockResolvedValue({ id: 'account-1', nameNormalized: 'acme', canonicalDomain: null });
    mockContactFindFirst.mockResolvedValue({ id: 'contact-1', accountId: 'account-1' });

    await handleImportChunk(CHUNK_PAYLOAD);

    const enrichmentPayloads = [...mockAccountUpdate.mock.calls, ...mockContactUpdate.mock.calls]
      .map(([args]) => (args as { data: Record<string, unknown> }).data)
      .filter(Boolean);

    expect(enrichmentPayloads.length).toBeGreaterThan(0);
    for (const data of enrichmentPayloads) {
      for (const [key, value] of Object.entries(data)) {
        expect(value, `enrichment carried a blank '${key}'`).not.toBe(null);
        expect(value, `enrichment carried an empty '${key}'`).not.toBe('');
      }
    }
  });

  it('still fails the row when the write throws for a reason other than the conflict it targets', async () => {
    // Convergence must not become "swallow every database error on this row".
    seedOneRow();
    mockAccountCreate.mockRejectedValueOnce(new Error('connection terminated'));

    const result = await handleImportChunk(CHUNK_PAYLOAD);

    expect(result.errors).toBe(1);
    expect(result.created).toBe(0);
    expect(mockRowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'error' }) })
    );
  });

  it('creates a lead with normalized fields', async () => {
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'John', lastName: 'Doe', email: 'john@test.com', company: 'Acme', phone: '555-0100', linkedIn: 'https://linkedin.com/in/JOHN' }),
    ]);
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });

    const result = await handleImportChunk(CHUNK_PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
    expect(mockLeadCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@test.com',
        company: 'Acme',
        normalizedEmail: 'john@test.com',
        normalizedPhone: '5550100',
        // Canonical profile path: scheme and www are dropped, so `linkedin.com/in/jane` and
        // `https://www.linkedin.com/in/jane/` stop deduping as two different people. Rows written
        // before this change hold the old scheme-carrying form and are re-normalised by the identity
        // backfill; until that runs, an old row and a new one will not match on LinkedIn.
        normalizedLinkedIn: 'linkedin.com/in/john',
        source: 'csv-import',
      }),
    });
  });

  it('updates ImportRow status to imported', async () => {
    mockRowFindMany.mockResolvedValue([makeRow('row-1', 1, { firstName: 'A', lastName: 'B', company: 'Acme', email: 'a@b.com' })]);
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });

    await handleImportChunk(CHUNK_PAYLOAD);

    expect(mockRowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-1' }, data: expect.objectContaining({ status: 'imported', leadId: 'lead-1' }) })
    );
  });

  it('creates an activity for the imported lead', async () => {
    mockRowFindMany.mockResolvedValue([makeRow('row-1', 1, { firstName: 'A', lastName: 'B', company: 'Acme', email: 'a@b.com' })]);
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });

    await handleImportChunk(CHUNK_PAYLOAD);

    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', leadId: 'lead-1', type: 'lead_created' }),
    });
  });

  it('enrolls in sequence when sequenceId is provided', async () => {
    mockRowFindMany.mockResolvedValue([makeRow('row-1', 1, { firstName: 'A', lastName: 'B', company: 'Acme', email: 'a@b.com' })]);
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });
    mockSequenceFindUnique.mockResolvedValue({
      id: 'seq-1',
      name: 'Test Sequence',
      steps: [{ id: 'step-1', order: 1, channel: 'email', delayDays: 0, delayHours: 0, instructions: 'test' }],
    });

    const result = await handleImportChunk({ ...CHUNK_PAYLOAD, sequenceId: 'seq-1' });

    expect(result.created).toBe(1);
    expect(mockLeadCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sequenceId: 'seq-1', sequenceStep: 1, sequenceStatus: 'active' }),
    });
    expect(createTaskForStep).toHaveBeenCalled();
  });

  it('returns skipped if no rows found', async () => {
    mockRowFindMany.mockResolvedValue([]);
    const result = await handleImportChunk(CHUNK_PAYLOAD);
    expect(result).toEqual({ skipped: true, reason: 'no_rows_found' });
  });
});

describe('handleImportCommit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('counts imported and error rows, updates batch', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowCount
      .mockResolvedValueOnce(0) // pending/valid in-flight check = 0
      .mockResolvedValueOnce(5) // imported count = 5
      .mockResolvedValueOnce(1) // updated count = 1
      .mockResolvedValueOnce(2); // error count = 2

    const result = await handleImportCommit({ batchId: 'batch-1' });

    expect(result).toEqual({ success: true, batchId: 'batch-1', imported: 5, updated: 1, errored: 2 });
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { status: 'committed', parsedRows: 6, errorRows: 2 },
    });
  });

  it('skips if already committed', async () => {
    mockBatchFindUnique.mockResolvedValue({ ...MOCK_BATCH, status: 'committed' });
    const result = await handleImportCommit({ batchId: 'batch-1' });
    expect(result).toEqual({ skipped: true, reason: 'already_committed' });
  });

  it('skips if batch not found', async () => {
    mockBatchFindUnique.mockResolvedValue(null);
    const result = await handleImportCommit({ batchId: 'batch-1' });
    expect(result).toEqual({ skipped: true, reason: 'batch_not_found' });
  });
});
