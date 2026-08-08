import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockTaskFindMany = vi.fn();
const mockTaskUpdate = vi.fn();
const mockLeadFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockOutboundFindMany = vi.fn();
const mockOutboundUpdate = vi.fn();
const mockJobRunFindMany = vi.fn();
const mockJobRunUpdate = vi.fn();
const mockAuditFindMany = vi.fn();
const mockAuditDeleteMany = vi.fn();
const mockNotificationCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: (...args: unknown[]) => mockTaskFindMany(...args),
      update: (...args: unknown[]) => mockTaskUpdate(...args),
    },
    lead: {
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    outboundMessage: {
      findMany: (...args: unknown[]) => mockOutboundFindMany(...args),
      update: (...args: unknown[]) => mockOutboundUpdate(...args),
    },
    jobRun: {
      findMany: (...args: unknown[]) => mockJobRunFindMany(...args),
      update: (...args: unknown[]) => mockJobRunUpdate(...args),
    },
    auditLog: {
      findMany: (...args: unknown[]) => mockAuditFindMany(...args),
      deleteMany: (...args: unknown[]) => mockAuditDeleteMany(...args),
    },
    notification: {
      create: (...args: unknown[]) => mockNotificationCreate(...args),
    },
  },
}));

vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: {
    run: (_: unknown, fn: () => unknown) => fn(),
  },
}));

const { handleRepair } = await import('@/workers/maintenance');

describe('handleRepair — orphan-tasks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks pending tasks as skipped when their lead is missing', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', leadId: 'lead-1', userId: 'user-1' }]);
    mockLeadFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' });

    const result = await handleRepair({ types: ['orphan-tasks'] });

    expect(result['orphan-tasks'].fixed).toBe(1);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1', status: 'pending' },
      data: { status: 'skipped', notes: expect.stringContaining('orphan') },
    });
  });

  it('marks pending tasks as skipped when their user is missing', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', leadId: 'lead-1', userId: 'user-1' }]);
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1' });
    mockUserFindUnique.mockResolvedValue(null);

    const result = await handleRepair({ types: ['orphan-tasks'] });

    expect(result['orphan-tasks'].fixed).toBe(1);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1', status: 'pending' },
      data: { status: 'skipped', notes: expect.stringContaining('orphan') },
    });
  });

  it('skips tasks where both lead and user exist', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', leadId: 'lead-1', userId: 'user-1' }]);
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1' });

    const result = await handleRepair({ types: ['orphan-tasks'] });

    expect(result['orphan-tasks'].fixed).toBe(0);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });
});

describe('handleRepair — stale-sending', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks stale sending messages with providerMessageId as sent', async () => {
    const oldDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockOutboundFindMany.mockResolvedValue([{ id: 'msg-1', providerMessageId: 'prov-123', updatedAt: oldDate }]);

    const result = await handleRepair({ types: ['stale-sending'] });

    expect(result['stale-sending'].fixed).toBe(1);
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'sent', sentAt: expect.any(Date) },
    });
  });

  it('parks stale sending messages without providerMessageId for reconciliation, not retry', async () => {
    // This used to write `failed`, which returned the row to the claimable pool — one
    // manual retry away from a second delivery of a message that may already have gone.
    const oldDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockOutboundFindMany.mockResolvedValue([{ id: 'msg-2', providerMessageId: null, claimedAt: oldDate }]);

    const result = await handleRepair({ types: ['stale-sending'] });

    expect(result['stale-sending'].fixed).toBe(1);
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-2' },
      data: { status: 'reconciliation_required', errorMessage: expect.any(String) },
    });
  });

  it('ages stale sends off claimedAt, which no unrelated write resets', async () => {
    mockOutboundFindMany.mockResolvedValue([]);

    await handleRepair({ types: ['stale-sending'] });

    expect(mockOutboundFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'sending', claimedAt: { lt: expect.any(Date) } },
      })
    );
  });
});

describe('handleRepair — outbound-reconcile', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  function ambiguousRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'msg-1',
      providerMessageId: null,
      repliedAt: null,
      bouncedAt: null,
      claimedAt: hoursAgo(48),
      updatedAt: hoursAgo(48),
      to: 'prospect@example.com',
      tenantId: 'tenant-1',
      lead: { id: 'lead-1', assignedToId: 'user-1' },
      ...overrides,
    };
  }

  it('settles an ambiguous send as sent once delivery evidence appears', async () => {
    mockOutboundFindMany.mockResolvedValue([ambiguousRow({ providerMessageId: 'prov-7' })]);

    const result = await handleRepair({ types: ['outbound-reconcile'] });

    expect(result['outbound-reconcile'].fixed).toBe(1);
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'sent', sentAt: expect.any(Date), errorMessage: null },
    });
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it('accepts a reply as evidence the message was delivered', async () => {
    mockOutboundFindMany.mockResolvedValue([ambiguousRow({ repliedAt: hoursAgo(1) })]);

    await handleRepair({ types: ['outbound-reconcile'] });

    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'sent', sentAt: expect.any(Date), errorMessage: null },
    });
  });

  it('leaves a recently ambiguous send alone so evidence can still arrive', async () => {
    mockOutboundFindMany.mockResolvedValue([ambiguousRow({ claimedAt: hoursAgo(2) })]);

    const result = await handleRepair({ types: ['outbound-reconcile'] });

    expect(result['outbound-reconcile'].fixed).toBe(0);
    expect(mockOutboundUpdate).not.toHaveBeenCalled();
  });

  it('gives up past the grace window without resending, and tells the owner', async () => {
    mockOutboundFindMany.mockResolvedValue([ambiguousRow()]);

    const result = await handleRepair({ types: ['outbound-reconcile'] });

    expect(result['outbound-reconcile'].fixed).toBe(1);
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'permanently_failed', errorMessage: expect.stringContaining('not resent') },
    });
    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'email_unconfirmed',
        tenantId: 'tenant-1',
      }),
    });
  });

  it('is safe to run twice — the second pass sees nothing left to do', async () => {
    mockOutboundFindMany.mockResolvedValueOnce([ambiguousRow()]).mockResolvedValueOnce([]);

    const first = await handleRepair({ types: ['outbound-reconcile'] });
    const second = await handleRepair({ types: ['outbound-reconcile'] });

    expect(first['outbound-reconcile'].fixed).toBe(1);
    expect(second['outbound-reconcile'].fixed).toBe(0);
  });
});

describe('handleRepair — stuck-running', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks active job runs older than 15m as failed', async () => {
    mockJobRunFindMany.mockResolvedValue([{ id: 'run-1' }]);

    const result = await handleRepair({ types: ['stuck-running'] });

    expect(result['stuck-running'].fixed).toBe(1);
    expect(mockJobRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'failed', completedAt: expect.any(Date), failedReason: expect.any(String) },
    });
  });
});

describe('handleRepair — missing-delayed', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('locks pending email tasks past due with no lock', async () => {
    const pastDate = new Date(Date.now() - 3600000);
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', dueDate: pastDate }]);

    const result = await handleRepair({ types: ['missing-delayed'] });

    expect(result['missing-delayed'].fixed).toBe(1);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { lockedAt: expect.any(Date) },
    });
  });
});

describe('handleRepair — reassignment-drift', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates task userId when lead reassigned', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', userId: 'old-user', lead: { assignedToId: 'new-user' } }]);

    const result = await handleRepair({ types: ['reassignment-drift'] });

    expect(result['reassignment-drift'].fixed).toBe(1);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { userId: 'new-user' },
    });
  });

  it('skips tasks where userId already matches lead assignee', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 'task-1', userId: 'user-1', lead: { assignedToId: 'user-1' } }]);

    const result = await handleRepair({ types: ['reassignment-drift'] });

    expect(result['reassignment-drift'].fixed).toBe(0);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });
});

describe('handleRepair — audit-prune', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUDIT_RETENTION_DAYS;
    delete process.env.ADMIN_AUDIT_RETENTION_DAYS;
    mockAuditFindMany.mockResolvedValue([]);
    mockAuditDeleteMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const daysAgo = (where: { createdAt: { lt: Date } }) =>
    Math.round((Date.now() - where.createdAt.lt.getTime()) / 86_400_000);

  it('defaults to 90 days for extension rows and 365 for admin.* rows', async () => {
    await handleRepair({ types: ['audit-prune'] });

    const [extensionCall, adminCall] = mockAuditFindMany.mock.calls.map((c) => c[0].where);

    expect(extensionCall.action).toEqual({ not: { startsWith: 'admin.' } });
    expect(daysAgo(extensionCall)).toBe(90);

    expect(adminCall.action).toEqual({ startsWith: 'admin.' });
    expect(daysAgo(adminCall)).toBe(365);
  });

  it('honors the retention env overrides', async () => {
    process.env.AUDIT_RETENTION_DAYS = '30';
    process.env.ADMIN_AUDIT_RETENTION_DAYS = '180';

    await handleRepair({ types: ['audit-prune'] });

    const [extensionCall, adminCall] = mockAuditFindMany.mock.calls.map((c) => c[0].where);
    expect(daysAgo(extensionCall)).toBe(30);
    expect(daysAgo(adminCall)).toBe(180);
  });

  it('never prunes admin.* rows earlier than the extension window', async () => {
    // A misconfigured admin floor must not delete the compliance-relevant trail
    // before the routine rows it outranks.
    process.env.AUDIT_RETENTION_DAYS = '200';
    process.env.ADMIN_AUDIT_RETENTION_DAYS = '10';

    await handleRepair({ types: ['audit-prune'] });

    const [extensionCall, adminCall] = mockAuditFindMany.mock.calls.map((c) => c[0].where);
    expect(daysAgo(extensionCall)).toBe(200);
    expect(daysAgo(adminCall)).toBe(200);
  });

  it('falls back to the defaults when an override is not a positive integer', async () => {
    process.env.AUDIT_RETENTION_DAYS = 'nonsense';
    process.env.ADMIN_AUDIT_RETENTION_DAYS = '-5';

    await handleRepair({ types: ['audit-prune'] });

    const [extensionCall, adminCall] = mockAuditFindMany.mock.calls.map((c) => c[0].where);
    expect(daysAgo(extensionCall)).toBe(90);
    expect(daysAgo(adminCall)).toBe(365);
  });

  it('deletes in bounded batches by id rather than one unbounded statement', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` }));
    mockAuditFindMany
      .mockResolvedValueOnce(full)          // extension: full batch -> loop again
      .mockResolvedValueOnce([{ id: 'a-last' }]) // extension: short batch -> stop
      .mockResolvedValue([]);               // admin: nothing
    mockAuditDeleteMany
      .mockResolvedValueOnce({ count: 1000 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    const result = await handleRepair({ types: ['audit-prune'] });

    expect(mockAuditFindMany.mock.calls[0][0].take).toBe(1000);
    expect(mockAuditDeleteMany).toHaveBeenCalledTimes(2);
    expect(mockAuditDeleteMany.mock.calls[0][0]).toEqual({ where: { id: { in: full.map((r) => r.id) } } });
    expect(result['audit-prune'].fixed).toBe(1001);
  });

  it('stops at the batch cap and says it will resume, rather than running unbounded', async () => {
    // A first run against a year of rows must not hold the table for the whole backlog.
    mockAuditFindMany.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}` })));
    mockAuditDeleteMany.mockResolvedValue({ count: 1000 });

    const result = await handleRepair({ types: ['audit-prune'] });

    // 20 batches per tier, two tiers.
    expect(mockAuditDeleteMany).toHaveBeenCalledTimes(40);
    expect(result['audit-prune'].fixed).toBe(40_000);
    expect(result['audit-prune'].details.join(' ')).toContain('resumes next run');
  });

  it('reports zero without deleting when nothing is old enough', async () => {
    const result = await handleRepair({ types: ['audit-prune'] });

    expect(result['audit-prune'].fixed).toBe(0);
    expect(mockAuditDeleteMany).not.toHaveBeenCalled();
  });
});

describe('handleRepair — multiple types', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('runs all requested repair types and returns per-type results', async () => {
    mockTaskFindMany.mockResolvedValue([]);
    mockOutboundFindMany.mockResolvedValue([]);
    mockJobRunFindMany.mockResolvedValue([]);
    mockAuditFindMany.mockResolvedValue([]);

    const result = await handleRepair({
      types: ['orphan-tasks', 'stale-sending', 'stuck-running', 'missing-delayed', 'reassignment-drift', 'audit-prune'],
    });

    expect(Object.keys(result)).toEqual(['orphan-tasks', 'stale-sending', 'stuck-running', 'missing-delayed', 'reassignment-drift', 'audit-prune']);
  });
});
