import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `unapplied-bounces` (owner, 2026-10-09: Spanco). A bounce stored before #257 in a sender mailbox
 * that was not the lead holder's matched no lead and never became a suppression, so the address was
 * sent the follow-up. The repair walks every stored bounce and suppresses each address that is not
 * suppressed yet — with its lead when one can be found, so the cadence stops too.
 */

const inboundFindMany = vi.fn();
const suppressionFindMany = vi.fn();
const outboundFindFirst = vi.fn();
const outboundUpdateMany = vi.fn();
const suppressRecipient = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    inboundMessage: { findMany: (...a: unknown[]) => inboundFindMany(...a) },
    suppressionEntry: { findMany: (...a: unknown[]) => suppressionFindMany(...a) },
    outboundMessage: {
      findFirst: (...a: unknown[]) => outboundFindFirst(...a),
      updateMany: (...a: unknown[]) => outboundUpdateMany(...a),
    },
  },
}));
vi.mock('@/lib/email/suppress', () => ({ suppressRecipient: (...a: unknown[]) => suppressRecipient(...a) }));
vi.mock('@/lib/tenant-context', () => ({ tenantStorage: { run: (_ctx: unknown, fn: () => unknown) => fn() } }));
vi.mock('@/lib/bullmq/enqueue', () => ({ enqueueReschedule: vi.fn() }));
vi.mock('@/lib/bullmq', () => ({ createAppWorker: vi.fn() }));

const { handleRepair } = await import('@/workers/maintenance');

const bounce = (id: string, email: string, over: Record<string, unknown> = {}) => ({
  id, tenantId: 't1', leadId: null, bouncedRecipient: email, bounceType: 'hard', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  inboundFindMany.mockResolvedValue([]);
  suppressionFindMany.mockResolvedValue([]);
  outboundFindFirst.mockResolvedValue(null);
  outboundUpdateMany.mockResolvedValue({ count: 1 });
  suppressRecipient.mockResolvedValue({ suppressed: true, newlySuppressed: true });
});

describe('handleRepair — unapplied-bounces', () => {
  it('suppresses a stored bounce that never became a suppression, with the lead of the latest send', async () => {
    inboundFindMany.mockResolvedValueOnce([bounce('b1', 'Zolkiflii@Spanco.com.my')]);
    outboundFindFirst.mockResolvedValue({ id: 'out-2', leadId: 'lead-7', bouncedAt: null });

    const result = await handleRepair({ types: ['unapplied-bounces'] });

    expect(result['unapplied-bounces'].fixed).toBe(1);
    expect(outboundFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 't1', to: { equals: 'zolkiflii@spanco.com.my', mode: 'insensitive' }, sentAt: { not: null } },
    }));
    expect(suppressRecipient).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', email: 'zolkiflii@spanco.com.my', leadId: 'lead-7', reason: 'hard_bounce',
    }));
    // The send is marked bounced, which the send-time check and the bounce rate read.
    expect(outboundUpdateMany).toHaveBeenCalledWith({
      where: { id: 'out-2', bouncedAt: null },
      data: { bouncedAt: expect.any(Date), bounceType: 'hard' },
    });
  });

  it('prefers the lead the bounce itself names', async () => {
    inboundFindMany.mockResolvedValueOnce([bounce('b1', 'a@x.com', { leadId: 'lead-1' })]);
    outboundFindFirst.mockResolvedValue({ id: 'out-9', leadId: 'lead-other', bouncedAt: new Date() });

    await handleRepair({ types: ['unapplied-bounces'] });

    expect(suppressRecipient).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1' }));
    expect(outboundUpdateMany).not.toHaveBeenCalled();
  });

  it('skips an address that is already suppressed in that tenant', async () => {
    inboundFindMany.mockResolvedValueOnce([bounce('b1', 'a@x.com'), bounce('b2', 'b@x.com')]);
    suppressionFindMany.mockResolvedValueOnce([{ tenantId: 't1', email: 'a@x.com' }]);

    const result = await handleRepair({ types: ['unapplied-bounces'] });

    expect(result['unapplied-bounces'].fixed).toBe(1);
    expect(suppressRecipient).toHaveBeenCalledTimes(1);
    expect(suppressRecipient).toHaveBeenCalledWith(expect.objectContaining({ email: 'b@x.com' }));
  });

  it('suppresses the address tenant-wide even when no lead can be found', async () => {
    inboundFindMany.mockResolvedValueOnce([bounce('b1', 'ghost@x.com', { bounceType: 'soft' })]);

    await handleRepair({ types: ['unapplied-bounces'] });

    expect(suppressRecipient).toHaveBeenCalledWith(expect.objectContaining({ email: 'ghost@x.com', leadId: null, reason: 'soft_bounce' }));
  });

  it('handles an address once per run, however many bounces name it', async () => {
    inboundFindMany.mockResolvedValueOnce([bounce('b1', 'a@x.com'), bounce('b2', 'A@x.com')]);

    await handleRepair({ types: ['unapplied-bounces'] });

    expect(suppressRecipient).toHaveBeenCalledTimes(1);
  });

  it('reads every page, not only the first', async () => {
    const page = Array.from({ length: 500 }, (_, i) => bounce(`b${String(i).padStart(3, '0')}`, `p${i}@x.com`));
    inboundFindMany.mockResolvedValueOnce(page).mockResolvedValueOnce([bounce('b-last', 'last@x.com')]);
    suppressionFindMany.mockImplementation(async ({ where }: { where: { email: { in: string[] } } }) =>
      where.email.in.filter((e) => e !== 'last@x.com').map((email) => ({ tenantId: 't1', email })),
    );

    const result = await handleRepair({ types: ['unapplied-bounces'] });

    expect(inboundFindMany).toHaveBeenCalledTimes(2);
    expect(inboundFindMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'b499' }, skip: 1 });
    expect(result['unapplied-bounces'].fixed).toBe(1);
  });

  it('reports an address it could not suppress instead of counting it fixed', async () => {
    inboundFindMany.mockResolvedValueOnce([bounce('b1', 'a@x.com')]);
    suppressRecipient.mockResolvedValue({ suppressed: false, newlySuppressed: false });

    const result = await handleRepair({ types: ['unapplied-bounces'] });

    expect(result['unapplied-bounces']).toMatchObject({ fixed: 0, details: [expect.stringContaining('could not suppress')] });
  });
});
