import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { chooseCallerId, pickCallerId } from '@/lib/telephony/callerId';
import { tenantStorage } from '@/lib/tenant-context';
import { createTestTenant } from './helpers/testTenant';

/**
 * Which number the lead sees (docs/dialer/TASKS.md D9.2): the country's default, then any number in
 * the country, then the overall default, then any number; the tenant's own active outbound numbers only.
 */

const n = (e164: string, country: string, flags: { isDefault?: boolean; isOverallDefault?: boolean } = {}) => ({
  e164,
  country,
  isDefault: false,
  isOverallDefault: false,
  ...flags,
});

describe('chooseCallerId', () => {
  const us1 = n('+14155550001', 'US');
  const us2 = n('+14155550002', 'US', { isDefault: true });
  const sg = n('+6561234567', 'SG', { isDefault: true });
  const gb = n('+442071234567', 'GB', { isOverallDefault: true });

  it('prefers the default of the dialled country over an older number there', () => {
    expect(chooseCallerId([us1, us2, sg, gb], 'US')).toBe(us2.e164);
  });

  it('falls back to the oldest number in the country when it has no default', () => {
    expect(chooseCallerId([n('+14155550001', 'US'), n('+14155550009', 'US'), gb], 'US')).toBe('+14155550001');
  });

  it('uses the overall default for a country with no number', () => {
    expect(chooseCallerId([us1, sg, gb], 'AU')).toBe(gb.e164);
    expect(chooseCallerId([us1, sg, gb], null)).toBe(gb.e164);
  });

  it('uses the oldest number when nothing is marked', () => {
    expect(chooseCallerId([us1, sg], 'AU')).toBe(us1.e164);
  });

  it('matches the country case-insensitively and returns null with no numbers', () => {
    expect(chooseCallerId([sg], 'sg')).toBe(sg.e164);
    expect(chooseCallerId([], 'SG')).toBeNull();
  });
});

describe('pickCallerId', () => {
  const inTenant = <T>(t: string, fn: () => Promise<T>) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

  it('reads only this tenant\'s active outbound numbers', async () => {
    const mine = `t-callerid-${randomUUID()}`;
    const theirs = `t-callerid-other-${randomUUID()}`;
    await createTestTenant(mine, 'Caller ID');
    await createTestTenant(theirs, 'Caller ID other');
    const suffix = () => String(Math.floor(1_000_000 + Math.random() * 8_999_999));
    const make = (t: string, data: Record<string, unknown>) =>
      inTenant(t, () => prisma.telephonyNumber.create({ data: { tenantId: t, e164: `+1415${suffix()}`, country: 'US', ...data } as never }));

    await make(theirs, { isDefault: true, isOverallDefault: true });
    await make(mine, { isActive: false, isDefault: true });
    await make(mine, { purpose: 'inbound', isDefault: true });
    const usable = await make(mine, {});

    expect(await pickCallerId(mine, 'US')).toBe(usable.e164);
    expect(await pickCallerId(`t-nobody-${randomUUID()}`, 'US')).toBeNull();
  });
});
