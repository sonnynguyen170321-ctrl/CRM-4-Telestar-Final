import { describe, expect, it } from 'vitest';

import { accountIdentityOf, resolveAccount } from '@/lib/identity/resolveAccount';
import { normalizeLinkedIn, normalizePhone } from '@/lib/leads/normalize';

// The identity writer is the reason a company stops arriving three times. These run against a fake
// db rather than Postgres: what is being asserted is which lookup wins and what gets written, and a
// real database would only make that slower to see.

type AccountRow = {
  id: string;
  name: string;
  nameNormalized: string | null;
  canonicalDomain: string | null;
  tenantId: string;
  createdAt: Date;
};

function fakeDb(seed: AccountRow[] = []) {
  const rows = [...seed];
  const calls: Array<Record<string, unknown>> = [];
  let next = seed.length;

  const matches = (row: AccountRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);

  return {
    rows,
    calls,
    account: {
      findFirst: async (args: unknown) => {
        const where = (args as { where: Record<string, unknown> }).where;
        calls.push(where);
        return rows.find((row) => matches(row, where)) ?? null;
      },
      create: async (args: unknown) => {
        const data = (args as { data: AccountRow }).data;
        const row = { ...data, id: `acc_${next++}`, createdAt: new Date() };
        rows.push(row);
        return { id: row.id };
      },
      update: async (args: unknown) => {
        const { where, data } = args as { where: { id: string }; data: Partial<AccountRow> };
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
  };
}

const TENANT = 'tenant_1';

describe('resolveAccount', () => {
  it('treats Vietnamese legal-form variants of one company as the same account', async () => {
    const db = fakeDb();

    const first = await resolveAccount(db, { tenantId: TENANT, name: 'Công ty TNHH ABC' });
    const second = await resolveAccount(db, { tenantId: TENANT, name: 'CTY TNHH ABC' });
    const third = await resolveAccount(db, { tenantId: TENANT, name: 'ABC' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second.accountId).toBe(first.accountId);
    expect(third.accountId).toBe(first.accountId);
    expect(db.rows).toHaveLength(1);
  });

  it('prefers the domain over the name, so a renamed company is not duplicated', async () => {
    const db = fakeDb();

    const original = await resolveAccount(db, {
      tenantId: TENANT,
      name: 'Acme Industries',
      website: 'https://www.acme.com/about',
    });
    const renamed = await resolveAccount(db, {
      tenantId: TENANT,
      name: 'Acme Group Holdings',
      domain: 'acme.com',
    });

    expect(renamed.created).toBe(false);
    expect(renamed.matchedBy).toBe('canonicalDomain');
    expect(renamed.accountId).toBe(original.accountId);
  });

  it('backfills identity columns on a legacy row it matched by raw name', async () => {
    const db = fakeDb([
      {
        id: 'acc_legacy',
        name: 'Công ty TNHH XYZ',
        nameNormalized: null,
        canonicalDomain: null,
        tenantId: TENANT,
        createdAt: new Date(),
      },
    ]);

    const result = await resolveAccount(db, {
      tenantId: TENANT,
      name: 'Công ty TNHH XYZ',
      website: 'xyz.vn',
    });

    expect(result.accountId).toBe('acc_legacy');
    expect(result.created).toBe(false);
    expect(db.rows[0].nameNormalized).toBeTruthy();
    expect(db.rows[0].canonicalDomain).toBe('xyz.vn');
  });

  it('keeps different companies apart', async () => {
    const db = fakeDb();
    await resolveAccount(db, { tenantId: TENANT, name: 'Công ty TNHH ABC' });
    const other = await resolveAccount(db, { tenantId: TENANT, name: 'Công ty TNHH ABD' });

    expect(other.created).toBe(true);
    expect(db.rows).toHaveLength(2);
  });

  it('does not leak across tenants', async () => {
    const db = fakeDb();
    const a = await resolveAccount(db, { tenantId: 'tenant_a', name: 'Shared Name Ltd' });
    const b = await resolveAccount(db, { tenantId: 'tenant_b', name: 'Shared Name Ltd' });

    expect(b.created).toBe(true);
    expect(b.accountId).not.toBe(a.accountId);
  });

  it('ignores a public email domain rather than keying every gmail company together', () => {
    expect(accountIdentityOf({ name: 'A', website: 'https://gmail.com' }).canonicalDomain).toBeNull();
  });
});

describe('identifier normalisation', () => {
  it('collapses LinkedIn profile URL spellings that used to dedupe as different people', () => {
    const canonical = normalizeLinkedIn('https://www.linkedin.com/in/jane/');
    expect(normalizeLinkedIn('linkedin.com/in/jane')).toBe(canonical);
    expect(normalizeLinkedIn('https://linkedin.com/in/jane?utm_source=x')).toBe(canonical);
  });

  it('resolves a local Vietnamese mobile to the same number as its international form', () => {
    expect(normalizePhone('0901234567', 'VN')).toBe(normalizePhone('+84 90 123 4567'));
  });

  it('keeps an unparseable number rather than dropping it', () => {
    expect(normalizePhone('12-34')).toBe('1234');
  });
});
