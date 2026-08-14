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
const mockContactUpsert = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockAccountCreate = vi.fn();
const mockAccountUpdate = vi.fn();
const mockAccountUpsert = vi.fn();
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
      contact: {
        findUnique: (...args: unknown[]) => mockContactFindUnique(...args),
        create: (...args: unknown[]) => mockContactCreate(...args),
        update: (...args: unknown[]) => mockContactUpdate(...args),
      },
      account: {
        findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
        create: (...args: unknown[]) => mockAccountCreate(...args),
        update: (...args: unknown[]) => mockAccountUpdate(...args),
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
      create: (...args: unknown[]) => mockLeadCreate(...args),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
    activity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    sequence: {
      findUnique: (...args: unknown[]) => mockSequenceFindUnique(...args),
    },
    contact: {
      findUnique: (...args: unknown[]) => mockContactFindUnique(...args),
      create: (...args: unknown[]) => mockContactCreate(...args),
      update: (...args: unknown[]) => mockContactUpdate(...args),
      upsert: (...args: unknown[]) => mockContactUpsert(...args),
    },
    account: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
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
    mockAccountUpsert.mockResolvedValue({ id: 'account-1', name: 'Acme', tenantId: 't1' });
    mockContactUpsert.mockResolvedValue({ id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@test.com', tenantId: 't1' });
    mockContactCreate.mockResolvedValue({ id: 'contact-1', firstName: 'John', lastName: 'Doe', email: 'john@test.com', tenantId: 't1' });
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
        normalizedLinkedIn: 'https://linkedin.com/in/john',
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

  /**
   * Confirmed against a live CI run, verbatim from the Postgres server itself, not inferred:
   *
   *   ERROR:  duplicate key value violates unique constraint "Account_tenantId_name_key"
   *   STATEMENT: INSERT INTO "public"."Account" ...
   *
   * find-then-create was a TOCTOU race: two chunk jobs for the same batch run under
   * `{ concurrency: 3 }`, and a stalled/redelivered job can overlap its own prior attempt, so two
   * rows resolving the same account or contact could both see "not found" and both try to create
   * it. The first fix caught that race's P2002 and re-read inside the *same* interactive
   * transaction — which cannot work: Postgres aborts an entire transaction the instant one
   * statement inside it errors, so the recovery read fails too, with "current transaction is
   * aborted", not a P2002. Confirmed against a second live CI run: the account race was still
   * there afterward, identically. `upsert` is what actually closes it — a single
   * `INSERT ... ON CONFLICT DO UPDATE` that Postgres itself serializes, so it never throws on the
   * exact conflict it targets and there is nothing to catch or retry.
   */
  it('resolves the account and contact through upsert, not find-then-create', async () => {
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'A', lastName: 'B', company: 'Acme', email: 'a@b.com' }),
    ]);
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });

    const result = await handleImportChunk(CHUNK_PAYLOAD);

    expect(result.created).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockAccountFindUnique).not.toHaveBeenCalled();
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockAccountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_name: { tenantId: 'tenant-1', name: 'Acme' } } })
    );
    expect(mockContactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_normalizedEmail: { tenantId: 'tenant-1', normalizedEmail: 'a@b.com' } },
      })
    );
    expect(mockLeadCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: 'account-1', contactId: 'contact-1' }),
    });
  });

  it('never lets a blank incoming field null out a value another row already set', async () => {
    // The account this row resolves to already has an industry from an earlier row; this row's
    // own data carries none. An `update:` payload built the naive way — forcing every optional
    // field to `null` when the row lacks it — would clobber that industry the moment two rows
    // for the same company are imported out of order. `nonBlank` is what an upsert needs instead
    // of the read-then-diff `fill()` used to compute: an omitted key writes nothing at all.
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'A', lastName: 'B', company: 'Acme', email: 'a@b.com' }),
    ]);
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });

    await handleImportChunk(CHUNK_PAYLOAD);

    const call = mockAccountUpsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('industry');
    expect(call.update).not.toHaveProperty('website');
    // The one field the row does supply is still written.
    expect(call.update.name).toBe('Acme');
    // create keeps every field, blank or not — a genuinely new account should not come out with
    // fields silently missing because they happened to be empty on the founding row.
    expect(call.create).toHaveProperty('industry', null);
  });

  it('still fails the row when the upsert throws for a reason other than the conflict it targets', async () => {
    mockRowFindMany.mockResolvedValue([
      makeRow('row-1', 1, { firstName: 'A', lastName: 'B', company: 'Acme', email: 'a@b.com' }),
    ]);
    mockAccountUpsert.mockRejectedValueOnce(new Error('connection reset'));

    const result = await handleImportChunk(CHUNK_PAYLOAD);

    expect(result.created).toBe(0);
    expect(result.errors).toBe(1);
    expect(mockRowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-1' }, data: expect.objectContaining({ status: 'error' }) })
    );
  });
});

describe('handleImportCommit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('counts imported and error rows, updates batch', async () => {
    mockBatchFindUnique.mockResolvedValue(MOCK_BATCH);
    mockRowCount
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

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
