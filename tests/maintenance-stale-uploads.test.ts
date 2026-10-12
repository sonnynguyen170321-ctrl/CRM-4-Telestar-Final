import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `stale-uploads`: files a rep uploaded in the composer and never sent are removed after a day,
 * tenant-wide and in bounded batches. A template's attachment or a file sent with a message is never
 * a candidate.
 */
const findMany = vi.fn();
const deleteMany = vi.fn();

vi.mock('@/lib/prisma', () => ({ prisma: { attachment: { findMany: (...a: unknown[]) => findMany(...a), deleteMany: (...a: unknown[]) => deleteMany(...a) } } }));
vi.mock('@/lib/tenant-context', () => ({ tenantStorage: { run: (_ctx: unknown, fn: () => unknown) => fn() } }));
vi.mock('@/lib/bullmq/enqueue', () => ({ enqueueReschedule: vi.fn() }));
vi.mock('@/lib/bullmq', () => ({ createAppWorker: vi.fn() }));

const { handleRepair } = await import('@/workers/maintenance');

beforeEach(() => {
  vi.clearAllMocks();
  deleteMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => ({ count: args.where.id.in.length }));
});

describe('handleRepair - stale-uploads', () => {
  it('selects only unbound ad-hoc uploads older than 24 hours', async () => {
    findMany.mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }]);
    const before = Date.now();
    const result = await handleRepair({ types: ['stale-uploads'] });

    expect(result['stale-uploads'].fixed).toBe(2);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ templateId: null, outboundMessageId: null, uploadedById: { not: null } });
    const cutoff = (where.createdAt.lt as Date).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] } } });
  });

  it('is bounded: it stops after ten full batches and resumes next run', async () => {
    findMany.mockImplementation(async () => Array.from({ length: 200 }, (_, i) => ({ id: `x${i}` })));
    const result = await handleRepair({ types: ['stale-uploads'] });
    expect(findMany).toHaveBeenCalledTimes(10);
    expect(result['stale-uploads'].fixed).toBe(2000);
  });

  it('does nothing when there is nothing stale', async () => {
    findMany.mockResolvedValue([]);
    const result = await handleRepair({ types: ['stale-uploads'] });
    expect(result['stale-uploads'].fixed).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
