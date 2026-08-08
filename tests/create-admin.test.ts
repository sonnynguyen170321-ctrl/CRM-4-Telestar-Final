/**
 * `create-admin` is the only supported way to rotate the Director password on a deployed box,
 * and it is reached for precisely when a credential is known, published or suspected stolen.
 *
 * It used to reset the password without touching `authVersion`. Sessions here are stateless
 * JWTs revalidated against that column, so the old password stopped working while every token
 * minted under it kept full Director access until it expired — the exact opposite of what
 * someone running this command believes they are getting. `docs/pre-domain-hardening/STATUS.md`
 * even told operators that changing the password would invalidate every existing session.
 *
 * These tests exist so that claim cannot quietly become false again.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compare } from 'bcryptjs';
import { prisma, tenantStorage } from '@/lib/prisma';
import { upsertDirector } from '@/scripts/create-admin';

// The script imports lib/prisma, which must not drag next-auth into Vitest.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const tenantId = 'create-admin-tenant';
const email = 'rotate-me@create-admin.test';

const hasDb = Boolean(process.env.DATABASE_URL);
const run = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

beforeAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.tenant.create({ data: { id: tenantId, name: 'Create Admin Tenant' } });
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await tenantStorage.run({ tenantId: 'system', bypassRls: true }, async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });
});

describe.skipIf(!hasDb)('create-admin', () => {
  it('creates a director when none exists', async () => {
    const outcome = await upsertDirector({
      email,
      password: 'first-strong-password',
      name: 'Dean Director',
      tenantId,
    });

    expect(outcome).toBe('created');

    const user = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    expect(user.role).toBe('director');
    expect(await compare('first-strong-password', user.password)).toBe(true);
  });

  it('revokes existing sessions when it resets the password', async () => {
    // Arrange: an account whose sessions are already at some version — the value is
    // deliberately not 1, so a test that passes by accident on a default would fail.
    const before = await run(() =>
      prisma.user.update({
        where: { email },
        data: { authVersion: 7, isActive: false, role: 'sdr' },
      })
    );
    expect(before.authVersion).toBe(7);

    // Act: the rotation an operator performs on the live box.
    const outcome = await upsertDirector({
      email,
      password: 'second-strong-password',
      name: 'Dean Director',
      tenantId,
    });

    // Assert
    expect(outcome).toBe('updated');
    const after = await run(() => prisma.user.findUniqueOrThrow({ where: { email } }));

    // The point of the fix: every token carrying authVersion 7 is now rejected on its next
    // request. Without the increment the password below would change and those tokens would
    // keep working.
    expect(after.authVersion).toBe(8);

    expect(await compare('second-strong-password', after.password)).toBe(true);
    expect(await compare('first-strong-password', after.password)).toBe(false);

    // It also promotes and reactivates, which is what makes it usable for recovery.
    expect(after.role).toBe('director');
    expect(after.isActive).toBe(true);
  });
});
