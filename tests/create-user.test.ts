/**
 * `create-user` is the only supported way to rotate or deactivate a *non-Director* account on
 * a deployed box. `create-admin` cannot do it: that script hardcodes `role: 'director'`, so
 * pointing it at an SDR rotates the password and promotes the account to Director.
 *
 * It used to write the new password without touching `authVersion`. Sessions here are
 * stateless JWTs revalidated against that column, so the old password stopped working while
 * every token minted under it kept full access until it expired — the same defect
 * `tests/create-admin.test.ts` was written to pin, left unfixed in the script that has to
 * clear the published `telestar2026` off eleven demo accounts.
 *
 * These tests exist so the claim cannot quietly become false again, and so that renaming
 * somebody does not sign them out.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compare } from 'bcryptjs';
import { prisma, tenantStorage } from '@/lib/prisma';
import { upsertUser } from '@/scripts/create-user';

// The script imports lib/prisma, which must not drag next-auth into Vitest.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const tenantId = 'create-user-tenant';
const email = 'rotate-me@create-user.test';

const hasDb = Boolean(process.env.DATABASE_URL);
const run = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

const seedSdr = (authVersion: number, isActive = true) =>
  run(() => prisma.user.update({ where: { email }, data: { authVersion, isActive, role: 'sdr' } }));

beforeAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.tenant.create({ data: { id: tenantId, name: 'Create User Tenant' } });
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });
});

describe.skipIf(!hasDb)('create-user', () => {
  it('creates a user at the requested role, not director', async () => {
    const result = await upsertUser({
      email,
      password: 'first-strong-password',
      firstName: 'Sam',
      lastName: 'Rep',
      role: 'sdr',
      tenantId,
    });

    expect(result.outcome).toBe('created');

    const user = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    // The whole reason this script exists rather than create-admin.
    expect(user.role).toBe('sdr');
    expect(await compare('first-strong-password', user.password)).toBe(true);
  });

  it('revokes existing sessions when it resets the password', async () => {
    // Arrange: sessions already at some version — deliberately not 1, so a test that passes
    // by accident on a default would fail.
    const before = await seedSdr(7);
    expect(before.authVersion).toBe(7);

    // Act: the rotation an operator performs on the live box to clear telestar2026.
    const result = await upsertUser({ email, password: 'second-strong-password', tenantId });

    // Assert: every token carrying authVersion 7 is rejected on its next request. Without
    // the increment the password changes and those tokens keep full access.
    expect(result).toEqual({ outcome: 'updated', sessionsRevoked: true });
    const after = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    expect(after.authVersion).toBe(8);

    expect(await compare('second-strong-password', after.password)).toBe(true);
    expect(await compare('first-strong-password', after.password)).toBe(false);

    // It must not promote — the defect that rules create-admin out for this job.
    expect(after.role).toBe('sdr');
  });

  it('revokes existing sessions when it deactivates the account', async () => {
    await seedSdr(7, true);

    const result = await upsertUser({ email, isActive: false, tenantId });

    expect(result).toEqual({ outcome: 'updated', sessionsRevoked: true });
    const after = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    // Deactivating without this leaves the open sessions working, which is the whole point
    // of deactivating instead of rotating.
    expect(after.authVersion).toBe(8);
    expect(after.isActive).toBe(false);
  });

  it('revokes existing sessions when the role changes', async () => {
    await seedSdr(7);

    const result = await upsertUser({ email, role: 'team_lead', tenantId });

    expect(result.sessionsRevoked).toBe(true);
    const after = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    expect(after.authVersion).toBe(8);
    expect(after.role).toBe('team_lead');
  });

  it('leaves sessions intact when only the name changes', async () => {
    await seedSdr(7);

    const result = await upsertUser({ email, firstName: 'Samantha', tenantId });

    // A rename is not an access change. Signing someone out for it would train operators to
    // avoid the tool, and the revocations above are what matter.
    expect(result).toEqual({ outcome: 'updated', sessionsRevoked: false });
    const after = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    expect(after.authVersion).toBe(7);
    expect(after.firstName).toBe('Samantha');
  });

  it('leaves sessions intact when the requested role is the one already held', async () => {
    await seedSdr(7);

    const result = await upsertUser({ email, role: 'sdr', tenantId });

    expect(result.sessionsRevoked).toBe(false);
    const after = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    expect(after.authVersion).toBe(7);
  });

  it('refuses a no-op update rather than silently doing nothing', async () => {
    await seedSdr(7);
    await expect(upsertUser({ email, tenantId })).rejects.toThrow(/No changes requested/);
  });

  it('refuses to create a user without the fields a new account needs', async () => {
    await expect(
      upsertUser({ email: 'brand-new@create-user.test', password: 'strong-password', tenantId })
    ).rejects.toThrow(/requires --password, --first-name, --last-name, and --role/);
  });
});
