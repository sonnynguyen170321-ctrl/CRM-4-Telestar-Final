import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The send path's second lock (owner, 2026-10-09). Mei's sequence sent step 1 to
 * zolkiflii@spanco.com.my, Gmail bounced it (`550 5.7.1 XGEMAIL_0011 Command rejected`), and the
 * follow-up went out anyway: suppression is written only when the inbox sync reads the bounce and
 * matches it to a lead, and that link had broken.
 *
 * Now every send also asks the records directly — a send to this address marked bounced, or a stored
 * bounce naming it — and an address with such evidence is suppressed and its cadence stopped before
 * anything goes out.
 */

const outboundFindFirst = vi.fn();
const inboundFindFirst = vi.fn();
const suppressionFindFirst = vi.fn();
const suppressionCreate = vi.fn();
const leadFindUnique = vi.fn();
const leadUpdate = vi.fn();
const activityCreate = vi.fn();
const pauseAllLeadCadences = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    outboundMessage: { findFirst: (...a: unknown[]) => outboundFindFirst(...a) },
    inboundMessage: { findFirst: (...a: unknown[]) => inboundFindFirst(...a) },
    suppressionEntry: {
      findFirst: (...a: unknown[]) => suppressionFindFirst(...a),
      create: (...a: unknown[]) => suppressionCreate(...a),
    },
    lead: { findUnique: (...a: unknown[]) => leadFindUnique(...a), update: (...a: unknown[]) => leadUpdate(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}));
vi.mock('@/lib/sequences/leadStop', () => ({ pauseAllLeadCadences: (...a: unknown[]) => pauseAllLeadCadences(...a) }));

const { blockIfBounced, findBounceEvidence } = await import('@/lib/email/suppress');

const TENANT = 'tenant-1';
const ADDRESS = 'zolkiflii@spanco.com.my';
const BOUNCED_AT = new Date('2026-10-08T03:10:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  outboundFindFirst.mockResolvedValue(null);
  inboundFindFirst.mockResolvedValue(null);
  suppressionFindFirst.mockResolvedValue(null);
  leadFindUnique.mockResolvedValue({ id: 'lead-1', tenantId: TENANT, assignedToId: 'sdr-1', emailInvalid: false, tags: [] });
});

describe('findBounceEvidence', () => {
  it('finds a send to the address that was marked bounced, whatever the case of the address', async () => {
    outboundFindFirst.mockResolvedValue({ bouncedAt: BOUNCED_AT, bounceType: 'hard' });

    expect(await findBounceEvidence({ tenantId: TENANT, email: ' Zolkiflii@Spanco.com.my ' })).toEqual({
      source: 'send', at: BOUNCED_AT, reason: 'hard_bounce',
    });
    expect(outboundFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT, bouncedAt: { not: null }, to: { equals: ADDRESS, mode: 'insensitive' } },
    }));
  });

  // The Spanco case: the bounce was stored, but never matched to a lead or a send.
  it('finds a stored bounce naming the address even when it was matched to nothing', async () => {
    inboundFindFirst.mockResolvedValue({ createdAt: BOUNCED_AT, bounceType: 'hard' });

    expect(await findBounceEvidence({ tenantId: TENANT, email: ADDRESS })).toEqual({
      source: 'bounce_message', at: BOUNCED_AT, reason: 'hard_bounce',
    });
    expect(inboundFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT, isBounce: true, bouncedRecipient: { equals: ADDRESS, mode: 'insensitive' } },
    }));
  });

  it('keeps a soft bounce soft', async () => {
    inboundFindFirst.mockResolvedValue({ createdAt: BOUNCED_AT, bounceType: 'soft' });
    expect((await findBounceEvidence({ tenantId: TENANT, email: ADDRESS }))?.reason).toBe('soft_bounce');
  });

  it('answers nothing for an address that never bounced, or no address', async () => {
    expect(await findBounceEvidence({ tenantId: TENANT, email: ADDRESS })).toBeNull();
    expect(await findBounceEvidence({ tenantId: TENANT, email: '  ' })).toBeNull();
    expect(outboundFindFirst).toHaveBeenCalledTimes(1);
  });
});

describe('blockIfBounced', () => {
  it('suppresses the address, marks the lead and stops every cadence on it', async () => {
    inboundFindFirst.mockResolvedValue({ createdAt: BOUNCED_AT, bounceType: 'hard' });

    const evidence = await blockIfBounced({ tenantId: TENANT, email: ADDRESS, leadId: 'lead-1', actorUserId: 'sdr-1' });

    expect(evidence).toMatchObject({ source: 'bounce_message' });
    expect(suppressionCreate).toHaveBeenCalledWith({ data: { tenantId: TENANT, email: ADDRESS, campaignId: null, reason: 'hard_bounce' } });
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead-1' }, data: expect.objectContaining({ emailInvalid: true }) }));
    expect(pauseAllLeadCadences).toHaveBeenCalledWith({ leadId: 'lead-1', reason: 'hard_bounce', actorUserId: 'sdr-1' });
  });

  it('changes nothing for an address with no bounce', async () => {
    expect(await blockIfBounced({ tenantId: TENANT, email: ADDRESS, leadId: 'lead-1' })).toBeNull();
    expect(suppressionCreate).not.toHaveBeenCalled();
    expect(pauseAllLeadCadences).not.toHaveBeenCalled();
  });
});

describe('both send paths ask it', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

  it('the sequence step, before the message is created, as a suppression', () => {
    expect(read('workers', 'sequence.ts')).toMatch(/\(await findSuppression\([\s\S]{0,200}\)\) \?\?\s*\(await blockIfBounced\(/);
  });

  it('the send worker, last thing before the provider call', () => {
    const worker = read('workers', 'email.ts');
    expect(worker).toMatch(/const bounced = suppressed\s*\?\s*null\s*:\s*await blockIfBounced\(/);
    expect(worker.indexOf('await blockIfBounced(')).toBeLessThan(worker.indexOf('emailService.send('));
  });
});
