import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Editing a pool record must leave it findable by what it now says.
 *
 * `LeadPoolItem` carries two derived columns: `duplicateKey`, which duplicate detection matches on,
 * and `normalizedCompany`, which the pool is grouped and deduped by. Creation set both. The edit
 * path set neither correctly.
 *
 * `buildPoolDuplicateKey` returns the *first* identifier present — email, else phone, else
 * LinkedIn, else name+company — and `enrichPoolItem` rebuilt the key from the patch alone:
 *
 *     patch.email || patch.phone || patch.linkedIn
 *       ? buildPoolDuplicateKey({ email: patch.email, phone: patch.phone, linkedIn: patch.linkedIn })
 *       : undefined
 *
 * So correcting only a phone number produced `phone:<number>` on a record that still held an
 * email. That is not merely a stale key: `findDuplicateLeadIds` matches by the key's tier, and the
 * phone tier only considers candidates that have no email of their own, so the downgraded record
 * could no longer be matched as a duplicate by anything. Clearing a field was the other half —
 * `patch.email || ...` is falsy for `''`, so removing an address left `email:<old address>` in
 * place, pointing at an address the record no longer had.
 *
 * These tests drive `enrichPoolItem` against the database and read the stored columns back, rather
 * than asserting on its return value — the defect was in what got persisted.
 */

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { enrichPoolItem, buildPoolDuplicateKey } = await import('@/lib/leadgen/pool');
type SessionUser = import('@/lib/auth').SessionUser;

const hasDb = Boolean(process.env.DATABASE_URL);

const TENANT = 'poolderive-tenant';
const USER = 'poolderive-user';

const actor: SessionUser = {
  id: USER,
  email: 'lg@poolderive.test',
  firstName: 'Lee',
  lastName: 'Gen',
  role: 'leadgen',
  tenantId: TENANT,
};

const runAs = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: TENANT, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let seq = 0;

/** A record with an email, so its key starts life in the `email:` tier. */
const givenPoolItem = (over: Record<string, unknown> = {}) => {
  const n = ++seq;
  const row = {
    firstName: 'Dana',
    lastName: `Prospect${n}`,
    company: 'Northwind Freight',
    email: `dana${n}@northwind-poolderive.test`,
    phone: '+1 415 555 0100',
    ...over,
  };
  return runAs(() =>
    prisma.leadPoolItem.create({
      data: {
        tenantId: TENANT,
        ...row,
        duplicateKey: buildPoolDuplicateKey(row),
        normalizedCompany: 'northwind freight',
      },
      select: { id: true, email: true, duplicateKey: true },
    })
  );
};

const stored = (id: string) =>
  runAs(() =>
    prisma.leadPoolItem.findFirstOrThrow({
      where: { id, tenantId: TENANT },
      select: { email: true, phone: true, duplicateKey: true, company: true, normalizedCompany: true },
    })
  );

const edit = (id: string, patch: Record<string, unknown>) =>
  runAs(() => enrichPoolItem({ id, patch, actor, tenantId: TENANT }));

describe.skipIf(!hasDb)('editing a pool record keeps its derived columns true', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.leadgenActivity.deleteMany({ where: { tenantId: TENANT } });
      await prisma.leadPoolItem.deleteMany({ where: { tenantId: TENANT } });
      await prisma.user.deleteMany({ where: { tenantId: TENANT } });
      await prisma.tenant.deleteMany({ where: { id: TENANT } });
    });
    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: TENANT, name: 'PoolDerive' } });
      await prisma.user.create({
        data: {
          id: USER,
          tenantId: TENANT,
          email: 'lg@poolderive.test',
          password: 'x',
          firstName: 'Lee',
          lastName: 'Gen',
          role: 'leadgen',
        },
      });
    });
  });

  beforeEach(() => {
    seq += 0;
  });

  it('does not downgrade an email key to a phone key when only the phone is corrected', async () => {
    const item = await givenPoolItem();
    expect(item.duplicateKey).toMatch(/^email:/);

    await edit(item.id, { phone: '+1 415 555 0199' });

    const after = await stored(item.id);
    expect(after.phone).toBe('+1 415 555 0199');
    // The record still has its email, so the key must still be the email one — a `phone:` key here
    // is invisible to the phone tier, which skips candidates that have an email.
    expect(after.duplicateKey).toBe(`email:${after.email}`);
  });

  it('moves the key down a tier when the email is actually removed', async () => {
    const item = await givenPoolItem();

    await edit(item.id, { email: '' });

    const after = await stored(item.id);
    // `patch.email || ...` was falsy for an empty string, so this used to keep pointing at an
    // address the record no longer held.
    expect(after.duplicateKey).toBe('phone:+14155550100');
  });

  it('recomputes the key from the whole record when the email itself changes', async () => {
    const item = await givenPoolItem();

    await edit(item.id, { email: 'moved@northwind-poolderive.test' });

    expect((await stored(item.id)).duplicateKey).toBe('email:moved@northwind-poolderive.test');
  });

  it('clears the key when the record has no identifier left to key on', async () => {
    const item = await givenPoolItem({ firstName: null, lastName: null });

    await edit(item.id, { email: '', phone: '' });

    // Null is the honest answer. Leaving the previous key behind claims an identity the record no
    // longer has, and the key was only written when it was non-undefined before.
    expect((await stored(item.id)).duplicateKey).toBeNull();
  });

  it('keeps the name fallback keyed on the new company after a rename', async () => {
    const item = await givenPoolItem({ email: null, phone: null });
    expect(item.duplicateKey).toMatch(/^name:/);

    await edit(item.id, { company: 'Southwind Logistics' });

    const after = await stored(item.id);
    expect(after.company).toBe('Southwind Logistics');
    expect(after.duplicateKey).toContain('southwind');
    // `normalizedCompany` is what the pool groups on, and the edit path never updated it, so a
    // renamed company kept being grouped under its old name.
    expect(after.normalizedCompany).not.toBe('northwind freight');
    expect(after.normalizedCompany).toContain('southwind');
  });

  it('leaves the key alone when the edit touches nothing it depends on', async () => {
    const item = await givenPoolItem();

    await edit(item.id, { title: 'Director of Logistics' });

    expect((await stored(item.id)).duplicateKey).toBe(item.duplicateKey);
  });
});
