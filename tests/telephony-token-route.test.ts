import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionUser } from '@/lib/auth';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { TELEPHONY_ENV } from '@/lib/env-contract';
import { prisma } from '@/lib/prisma';
import {
  CredentialRevokedError,
  TOKEN_MIN_INTERVAL_MS,
  TokenRateLimitedError,
  credentialLabel,
  issueRepToken,
} from '@/lib/telephony/credentials';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import { tenantStorage } from '@/lib/tenant-context';
import { POST } from '@/app/api/telephony/token/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * A rep's softphone login (docs/dialer/, Phase 2), against a real database.
 *
 * The token endpoint is the only way a browser gets onto the phone network, so: it is refused
 * unless the deployment and the team have the dialer on, a rep only ever gets their own login, two
 * racing first requests leave one credential (and none orphaned at the provider), and a loop asking
 * for tokens is cut off — without a provider hiccup also locking the rep out.
 */

const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED'] as const;
let savedEnv: Record<string, string | undefined> = {};
let fake: FakeTelephonyProvider;
let tenantId: string;
let otherTenantId: string;
const users = { rep: null as unknown as SessionUser, other: null as unknown as SessionUser };

const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function makeUser(t: string): Promise<SessionUser> {
  const row = await inTenant(
    () => prisma.user.create({ data: { tenantId: t, email: `sdr.${randomUUID()}@t.test`, firstName: 'S', lastName: 'R', password: 'x', role: 'sdr' } }),
    t
  );
  return { id: row.id, email: row.email, firstName: 'S', lastName: 'R', role: 'sdr', tenantId: t };
}

async function settings(t: string, data: { enabled: boolean; killedAt?: Date | null }) {
  await inTenant(() => prisma.telephonySettings.create({ data: { tenantId: t, ...data } }), t);
}

async function requestToken(user: SessionUser | null) {
  authUser.current = user;
  const response = await POST();
  return { response, body: await response.json() };
}

const credentialRows = (userId: string) => inTenant(() => prisma.telephonyCredential.findMany({ where: { userId } }));

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TELEPHONY_ENV) process.env[k] = `test-value-for-${k}-long-enough-to-satisfy-checks`;
  process.env.TELEPHONY_ENABLED = 'true';
  fake = new FakeTelephonyProvider();
  setTelephonyProviderForTests(fake);

  tenantId = `t-teltoken-${randomUUID()}`;
  otherTenantId = `t-teltoken-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Telephony token');
  await createTestTenant(otherTenantId, 'Telephony token other');
  users.rep = await makeUser(tenantId);
  users.other = await makeUser(otherTenantId);
  await settings(tenantId, { enabled: true });
});

afterEach(() => {
  setTelephonyProviderForTests(null);
  authUser.current = null;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('POST /api/telephony/token', () => {
  it('requires a session', async () => {
    const { response } = await requestToken(null);
    expect(response.status).toBe(401);
    expect(fake.credentials.size).toBe(0);
  });

  it('gives a rep a token for their own credential, created on first use, never cached', async () => {
    const { response, body } = await requestToken(users.rep);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [row] = await credentialRows(users.rep.id);
    expect(row).toMatchObject({ tenantId, provider: 'fake', status: 'active' });
    expect(body).toEqual({ token: expect.stringContaining(row.providerCredentialId), expiresAt: expect.any(String), sipUsername: row.sipUsername });
    expect(fake.credentials.get(row.providerCredentialId)).toMatchObject({ label: `crm:${tenantId}:${users.rep.id}`, tag: `tenant:${tenantId}` });
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  it('reuses the credential on later requests instead of creating another', async () => {
    const now = new Date();
    await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now }));
    await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now: new Date(now.getTime() + TOKEN_MIN_INTERVAL_MS + 1) }));
    expect(await credentialRows(users.rep.id)).toHaveLength(1);
    expect(fake.credentials.size).toBe(1);
    expect(fake.tokensMinted).toHaveLength(2);
  });

  it('is refused when the deployment switch is off, and creates nothing', async () => {
    process.env.TELEPHONY_ENABLED = 'false';
    const { response, body } = await requestToken(users.rep);
    expect(response.status).toBe(403);
    expect(body.code).toBe('dialer_disabled');
    expect(fake.credentials.size).toBe(0);
  });

  it('is refused when the deployment is missing a Telnyx variable', async () => {
    delete process.env.TELEPHONY_AUTH_SECRET;
    expect((await requestToken(users.rep)).response.status).toBe(403);
  });

  it('is refused for a team that has not turned the dialer on, or has hit the kill switch', async () => {
    // The other tenant has no settings row at all.
    expect((await requestToken(users.other)).body.code).toBe('dialer_disabled');
    await settings(otherTenantId, { enabled: false });
    expect((await requestToken(users.other)).body.code).toBe('dialer_disabled');

    await inTenant(() => prisma.telephonySettings.update({ where: { tenantId }, data: { killedAt: new Date() } }));
    const { response, body } = await requestToken(users.rep);
    expect(response.status).toBe(403);
    expect(body.code).toBe('dialer_disabled');
    expect(fake.credentials.size).toBe(0);
  });

  it('never lets one tenant’s settings switch on another tenant', async () => {
    // Tenant A is enabled (beforeEach); the rep in tenant B must still be refused.
    const { response } = await requestToken(users.other);
    expect(response.status).toBe(403);
    expect(await inTenant(() => prisma.telephonyCredential.count({ where: { tenantId: otherTenantId } }), otherTenantId)).toBe(0);
  });

  it('cuts off a second request inside the interval with 429 and Retry-After', async () => {
    expect((await requestToken(users.rep)).response.status).toBe(200);
    const { response, body } = await requestToken(users.rep);
    expect(response.status).toBe(429);
    expect(body.code).toBe('rate_limited');
    expect(response.headers.get('Retry-After')).toBe('10');
    expect(fake.tokensMinted).toHaveLength(1);
  });

  it('refuses a revoked credential and does not mint', async () => {
    await requestToken(users.rep);
    await inTenant(() => prisma.telephonyCredential.updateMany({ where: { userId: users.rep.id }, data: { status: 'revoked', revokedAt: new Date() } }));
    authUser.current = users.rep;
    const response = await POST();
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('credential_revoked');
    expect(fake.tokensMinted).toHaveLength(1);
  });

  it('answers 503 when the provider fails, and does not lock the rep out for the interval', async () => {
    fake.failNext.mintToken = new TelephonyProviderError('down', 503, true);
    const failed = await requestToken(users.rep);
    expect(failed.response.status).toBe(503);
    expect(failed.body.code).toBe('provider_unavailable');

    const retried = await requestToken(users.rep);
    expect(retried.response.status).toBe(200);
  });

  it('answers 503 when the credential cannot be created, and stores no row', async () => {
    fake.failNext.createCredential = new TelephonyProviderError('down', 500, true);
    expect((await requestToken(users.rep)).response.status).toBe(503);
    expect(await credentialRows(users.rep.id)).toHaveLength(0);

    // The failed creation is forgotten: the next request tries again rather than replaying the failure.
    expect((await requestToken(users.rep)).response.status).toBe(200);
    expect(await credentialRows(users.rep.id)).toHaveLength(1);
  });
});

describe('issueRepToken', () => {
  it('leaves one credential and no orphan at the provider when first requests race', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => inTenant(() => issueRepToken({ tenantId, userId: users.rep.id })))
    );

    const rows = await credentialRows(users.rep.id);
    expect(rows).toHaveLength(1);
    expect([...fake.credentials.keys()]).toEqual([rows[0].providerCredentialId]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(TokenRateLimitedError);
    }
  });

  it('keeps the credential that won a race and removes the loser at the provider', async () => {
    // Deterministic version of the race: while this request is creating a credential at the
    // provider, another request for the same rep stores theirs first.
    const winner = { id: '' };
    const original = fake.createCredential.bind(fake);
    fake.createCredential = async (input) => {
      const theirs = await original(input);
      winner.id = theirs.providerCredentialId;
      await inTenant(() =>
        prisma.telephonyCredential.create({
          data: { tenantId, userId: users.rep.id, provider: 'fake', providerCredentialId: theirs.providerCredentialId, sipUsername: theirs.sipUsername },
        })
      );
      return original(input);
    };

    const token = await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id }));

    const rows = await credentialRows(users.rep.id);
    expect(rows.map((r) => r.providerCredentialId)).toEqual([winner.id]);
    expect([...fake.credentials.keys()]).toEqual([winner.id]);
    expect(fake.tokensMinted).toEqual([winner.id]);
    expect(token.sipUsername).toBe(rows[0].sipUsername);
  });

  it('creates one credential at the provider however many first requests arrive at once', async () => {
    // A provider that takes a moment, as Telnyx does, so every request is in flight before the first
    // create lands and none of them can simply adopt it by name.
    const original = fake.createCredential.bind(fake);
    fake.createCredential = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return original(input);
    };
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => inTenant(() => issueRepToken({ tenantId, userId: users.rep.id })))
    );
    expect(fake.credentialsCreated).toBe(1);
    expect(await credentialRows(users.rep.id)).toHaveLength(1);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(TokenRateLimitedError);
    }
  });

  it('adopts a credential the provider already holds under the rep’s name instead of creating another', async () => {
    const earlier = await fake.createCredential({ label: credentialLabel(tenantId, users.rep.id), tag: `tenant:${tenantId}` });
    fake.credentialsCreated = 0;

    await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id }));

    expect(fake.credentialsCreated).toBe(0);
    expect((await credentialRows(users.rep.id))[0].providerCredentialId).toBe(earlier.providerCredentialId);
  });

  it('adopts a just-saved credential it missed, without revoking it', async () => {
    const now = new Date();
    await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now }));
    const [saved] = await credentialRows(users.rep.id);
    // This request's first read happened just before the other one committed.
    const spy = vi.spyOn(prisma.telephonyCredential, 'findFirst').mockResolvedValueOnce(null);
    try {
      await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now: new Date(now.getTime() + TOKEN_MIN_INTERVAL_MS + 1) }));
    } finally {
      spy.mockRestore();
    }
    expect(fake.credentials.has(saved.providerCredentialId)).toBe(true);
    expect(fake.credentialsCreated).toBe(1);
    expect(await credentialRows(users.rep.id)).toEqual([expect.objectContaining({ id: saved.id })]);
  });

  it('removes the provider credential when its row cannot be saved', async () => {
    const spy = vi.spyOn(prisma.telephonyCredential, 'create').mockRejectedValueOnce(new Error('database unavailable'));
    try {
      await expect(inTenant(() => issueRepToken({ tenantId, userId: users.rep.id }))).rejects.toThrow('database unavailable');
    } finally {
      spy.mockRestore();
    }
    expect(fake.credentialsCreated).toBe(1);
    expect(fake.credentials.size).toBe(0);
    expect(await credentialRows(users.rep.id)).toHaveLength(0);
  });

  it('never revokes a credential that another rep’s row holds', async () => {
    // Corrupt state: the provider hands back an id a colleague's row already uses.
    const colleague = await makeUser(tenantId);
    await inTenant(() => issueRepToken({ tenantId, userId: colleague.id }));
    const [theirs] = await credentialRows(colleague.id);
    fake.createCredential = async () => ({ providerCredentialId: theirs.providerCredentialId, sipUsername: 'dup' });

    await expect(inTenant(() => issueRepToken({ tenantId, userId: users.rep.id }))).rejects.toThrow();

    expect(fake.credentials.has(theirs.providerCredentialId)).toBe(true);
    expect(await credentialRows(users.rep.id)).toHaveLength(0);
  });

  it('allows the next token exactly once the interval has passed', async () => {
    const now = new Date('2026-10-05T03:00:00Z');
    await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now }));
    await expect(
      inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now: new Date(now.getTime() + TOKEN_MIN_INTERVAL_MS) }))
    ).rejects.toBeInstanceOf(TokenRateLimitedError);
    await expect(
      inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now: new Date(now.getTime() + TOKEN_MIN_INTERVAL_MS + 1) }))
    ).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('treats a credential with revokedAt set as revoked even if its status was not updated', async () => {
    await inTenant(() => issueRepToken({ tenantId, userId: users.rep.id }));
    await inTenant(() => prisma.telephonyCredential.updateMany({ where: { userId: users.rep.id }, data: { revokedAt: new Date() } }));
    await expect(inTenant(() => issueRepToken({ tenantId, userId: users.rep.id, now: new Date(Date.now() + 60_000) }))).rejects.toBeInstanceOf(
      CredentialRevokedError
    );
  });
});
