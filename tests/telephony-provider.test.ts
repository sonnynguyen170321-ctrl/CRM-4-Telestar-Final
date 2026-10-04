import { createHmac, generateKeyPairSync, sign } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TELEPHONY_ENV } from '@/lib/env-contract';
import {
  CALL_TOKEN_TTL_SECONDS,
  fromClientState,
  issueCallToken,
  toClientState,
  verifyCallToken,
} from '@/lib/telephony/authToken';
import { isTelephonyConfigured, isTelephonyDryRun, isTelephonyEnabled, missingTelephonyEnv } from '@/lib/telephony/flags';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import { TelnyxProvider } from '@/lib/telephony/telnyx/client';
import { MAX_WEBHOOK_SKEW_SECONDS, verifyTelnyxWebhook } from '@/lib/telephony/telnyx/verify';

/**
 * The dialer's provider seam (docs/dialer/, Phase 2), without a network or a database.
 *
 * Webhook signatures and call tokens are the two checks that stand between the internet and a
 * phone call being placed, so each failure branch is pinned. The Telnyx client is tested against a
 * fake `fetch`: what it retries, what it gives up on at once, and what it treats as already done.
 */

const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.TELEPHONY_AUTH_SECRET = 's'.repeat(40); // generated, so the secret scanner sees no literal key
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

// ---------------------------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------------------------

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
/** The portal shows the raw 32-byte key, base64 — the last 32 bytes of the SPKI encoding. */
const PORTAL_KEY = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64');
const NOW = 1_790_000_000;
const BODY = '{"data":{"event_type":"call.initiated","id":"evt-1"}}';

function signed(body = BODY, timestamp = String(NOW)) {
  return sign(null, Buffer.from(`${timestamp}|${body}`, 'utf8'), privateKey).toString('base64');
}

describe('verifyTelnyxWebhook', () => {
  const check = (overrides: Partial<Parameters<typeof verifyTelnyxWebhook>[0]> = {}) =>
    verifyTelnyxWebhook({ rawBody: BODY, signature: signed(), timestamp: String(NOW), publicKey: PORTAL_KEY, nowSeconds: NOW, ...overrides });

  it('accepts a body signed with the portal key', () => {
    expect(check()).toEqual({ ok: true });
  });

  it('rejects a body changed by one byte', () => {
    expect(check({ rawBody: BODY.replace('evt-1', 'evt-2') })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature over a different timestamp', () => {
    expect(check({ signature: signed(BODY, String(NOW - 1)) })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a signature made with another key', () => {
    const other = generateKeyPairSync('ed25519');
    const forged = sign(null, Buffer.from(`${NOW}|${BODY}`, 'utf8'), other.privateKey).toString('base64');
    expect(check({ signature: forged })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('accepts a timestamp exactly at the skew limit and refuses one second past it, either side', () => {
    const at = (offset: number) => {
      const ts = String(NOW + offset);
      return check({ timestamp: ts, signature: signed(BODY, ts) });
    };
    expect(at(MAX_WEBHOOK_SKEW_SECONDS)).toEqual({ ok: true });
    expect(at(-MAX_WEBHOOK_SKEW_SECONDS)).toEqual({ ok: true });
    expect(at(MAX_WEBHOOK_SKEW_SECONDS + 1)).toEqual({ ok: false, reason: 'stale' });
    expect(at(-MAX_WEBHOOK_SKEW_SECONDS - 1)).toEqual({ ok: false, reason: 'stale' });
  });

  it('refuses missing headers, a non-numeric timestamp, and a key that is not 32 bytes', () => {
    expect(check({ signature: null })).toEqual({ ok: false, reason: 'missing_headers' });
    expect(check({ timestamp: null })).toEqual({ ok: false, reason: 'missing_headers' });
    expect(check({ timestamp: '17900e5' })).toEqual({ ok: false, reason: 'bad_timestamp' });
    expect(check({ publicKey: Buffer.alloc(31).toString('base64') })).toEqual({ ok: false, reason: 'bad_key' });
    expect(check({ signature: 'not base64 at all!!' })).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

// ---------------------------------------------------------------------------------------------
// Call tokens
// ---------------------------------------------------------------------------------------------

describe('call tokens', () => {
  const claims = { callId: 'call-1', tenantId: 'tenant-a', userId: 'user-1', toE164: '+84948200638' };

  it('round-trips every binding claim and expires after the TTL', () => {
    const token = issueCallToken(claims, NOW);
    expect(verifyCallToken(token, NOW)).toEqual({ ok: true, claims: { ...claims, expiresAt: NOW + CALL_TOKEN_TTL_SECONDS } });
    expect(verifyCallToken(token, NOW + CALL_TOKEN_TTL_SECONDS - 1).ok).toBe(true);
    expect(verifyCallToken(token, NOW + CALL_TOKEN_TTL_SECONDS)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token whose claims were edited, even to a well-formed payload', () => {
    const [, signature] = issueCallToken(claims, NOW).split('.');
    const edited = Buffer.from(JSON.stringify({ c: 'call-1', t: 'tenant-a', u: 'user-1', n: '+19005550100', e: NOW + 120 })).toString('base64url');
    expect(verifyCallToken(`${edited}.${signature}`, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a token signed under another secret', () => {
    const token = issueCallToken(claims, NOW);
    process.env.TELEPHONY_AUTH_SECRET = 'd'.repeat(40);
    expect(verifyCallToken(token, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of [null, undefined, '', 'abc', 'a.b.c', '.sig', 'payload.']) {
      expect(verifyCallToken(bad as string, NOW)).toEqual({ ok: false, reason: expect.stringMatching(/malformed|bad_signature/) });
    }
  });

  it('rejects a correctly signed payload that is not a claims object, without throwing', () => {
    for (const json of ['null', '42', '"text"', '{"c":"x"}']) {
      const payload = Buffer.from(json).toString('base64url');
      const mac = createHmac('sha256', process.env.TELEPHONY_AUTH_SECRET!).update(payload).digest('base64url');
      expect(verifyCallToken(`${payload}.${mac}`, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('refuses to sign with a missing or short secret', () => {
    process.env.TELEPHONY_AUTH_SECRET = 'short';
    expect(() => issueCallToken(claims, NOW)).toThrow(/TELEPHONY_AUTH_SECRET/);
    delete process.env.TELEPHONY_AUTH_SECRET;
    expect(() => issueCallToken(claims, NOW)).toThrow(/TELEPHONY_AUTH_SECRET/);
  });

  it('survives the base64 client-state wrapping the SDK applies', () => {
    const token = issueCallToken(claims, NOW);
    expect(fromClientState(toClientState(token))).toBe(token);
    expect(fromClientState(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------------------------

describe('telephony flags', () => {
  function configureAll() {
    for (const k of TELEPHONY_ENV) process.env[k] = `value-for-${k}-that-is-long-enough-to-pass`;
  }

  it('is unconfigured until every Telnyx variable is set, and names the missing ones', () => {
    for (const k of TELEPHONY_ENV) delete process.env[k];
    expect(isTelephonyConfigured()).toBe(false);
    expect(missingTelephonyEnv()).toEqual([...TELEPHONY_ENV]);
    configureAll();
    process.env.TELNYX_PUBLIC_KEY = '   ';
    expect(missingTelephonyEnv()).toEqual(['TELNYX_PUBLIC_KEY']);
  });

  it('counts a signing secret shorter than 32 characters as missing', () => {
    configureAll();
    process.env.TELEPHONY_AUTH_SECRET = 'x'.repeat(31);
    expect(missingTelephonyEnv()).toEqual(['TELEPHONY_AUTH_SECRET']);
    process.env.TELEPHONY_AUTH_SECRET = ` ${'x'.repeat(40)} `;
    expect(missingTelephonyEnv()).toEqual(['TELEPHONY_AUTH_SECRET']);
    process.env.TELEPHONY_AUTH_SECRET = 'x'.repeat(32);
    expect(isTelephonyConfigured()).toBe(true);
  });

  it('is enabled only when configured AND TELEPHONY_ENABLED is exactly "true" AND the tenant is not a demo', () => {
    configureAll();
    process.env.TELEPHONY_ENABLED = 'true';
    expect(isTelephonyEnabled('tenant-a')).toBe(true);
    expect(isTelephonyEnabled('demo-tenant')).toBe(false);
    expect(isTelephonyEnabled('demo-acme')).toBe(false);
    for (const value of ['TRUE', '1', 'yes', ' true', '']) {
      process.env.TELEPHONY_ENABLED = value;
      expect(isTelephonyEnabled('tenant-a')).toBe(false);
    }
    process.env.TELEPHONY_ENABLED = 'true';
    delete process.env.TELNYX_API_KEY;
    expect(isTelephonyEnabled('tenant-a')).toBe(false);
  });

  it('stays in dry-run unless TELEPHONY_DRY_RUN is exactly "false", and demos are always dry-run', () => {
    delete process.env.TELEPHONY_DRY_RUN;
    expect(isTelephonyDryRun('tenant-a')).toBe(true);
    process.env.TELEPHONY_DRY_RUN = 'FALSE';
    expect(isTelephonyDryRun('tenant-a')).toBe(true);
    process.env.TELEPHONY_DRY_RUN = 'false';
    expect(isTelephonyDryRun('tenant-a')).toBe(false);
    expect(isTelephonyDryRun('demo-tenant')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Telnyx REST client
// ---------------------------------------------------------------------------------------------

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected request');
    if (reply instanceof Error) throw reply;
    const text = typeof reply.body === 'string' ? reply.body : reply.body === undefined ? '' : JSON.stringify(reply.body);
    return new Response(reply.status === 204 ? null : text, { status: reply.status, headers: reply.headers });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function provider(replies: Reply[]) {
  const { impl, calls } = fakeFetch(replies);
  const sleeps: number[] = [];
  const telnyx = new TelnyxProvider({
    apiKey: 'KEY_secret',
    credentialConnectionId: 'conn-1',
    fetchImpl: impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { telnyx, calls, sleeps };
}

describe('TelnyxProvider', () => {
  it('creates a credential on the configured connection and returns its SIP user', async () => {
    const { telnyx, calls } = provider([{ status: 201, body: { data: { id: 'cred-1', sip_username: 'gencredABC' } } }]);
    await expect(telnyx.createCredential({ label: 'crm:t:u', tag: 'tenant:t' })).resolves.toEqual({
      providerCredentialId: 'cred-1',
      sipUsername: 'gencredABC',
    });
    expect(calls[0].url).toBe('https://api.telnyx.com/v2/telephony_credentials');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ connection_id: 'conn-1', name: 'crm:t:u', tag: 'tenant:t' });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer KEY_secret');
  });

  it('never retries a credential create, so a lost answer cannot become two credentials', async () => {
    const { telnyx, calls } = provider([{ status: 503 }, { status: 201, body: { data: { id: 'cred-2', sip_username: 'u2' } } }]);
    await expect(telnyx.createCredential({ label: 'l', tag: 't' })).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  it('adopts a credential only when its name matches exactly and it has not expired', async () => {
    const list = (data: unknown[]) => ({ status: 200, body: { data } });
    const { telnyx, calls } = provider([
      list([{ id: 'other', name: 'crm:t:u2', sip_username: 'x' }, { id: 'mine', name: 'crm:t:u', sip_username: 'gencredMine' }]),
      list([{ id: 'old', name: 'crm:t:u', sip_username: 'y', expired: true }]),
      list([{ id: 'other', name: 'crm:t:u2', sip_username: 'x' }]),
    ]);
    await expect(telnyx.findCredentialByName('crm:t:u')).resolves.toEqual({ providerCredentialId: 'mine', sipUsername: 'gencredMine' });
    await expect(telnyx.findCredentialByName('crm:t:u')).resolves.toBeNull();
    await expect(telnyx.findCredentialByName('crm:t:u')).resolves.toBeNull();
    expect(new URL(calls[0].url).searchParams.get('filter[name]')).toBe('crm:t:u');
  });

  it('retries a body that fails to arrive, like a request that fails to answer', async () => {
    const stalled = new Response(new ReadableStream({ start: (c) => c.error(new Error('aborted')) }), { status: 200 });
    let first = true;
    const impl = (async () => {
      if (first) {
        first = false;
        return stalled;
      }
      return new Response('jwt-after-retry', { status: 200 });
    }) as unknown as typeof fetch;
    const telnyx = new TelnyxProvider({ apiKey: 'k', credentialConnectionId: 'c', fetchImpl: impl, sleep: async () => {} });
    await expect(telnyx.mintToken('cred-1')).resolves.toMatchObject({ token: 'jwt-after-retry' });
  });

  it('retries 429 and 5xx, honouring retry-after, then succeeds', async () => {
    const { telnyx, calls, sleeps } = provider([
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 503 },
      { status: 200, body: 'jwt-token' },
    ]);
    await expect(telnyx.mintToken('cred-1')).resolves.toMatchObject({ token: 'jwt-token' });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 500]);
  });

  it('caps a long retry-after so a user request is not held for minutes', async () => {
    const { telnyx, sleeps } = provider([{ status: 429, headers: { 'retry-after': '600' } }, { status: 200, body: 'jwt' }]);
    await telnyx.mintToken('cred-1');
    expect(sleeps).toEqual([5000]);
  });

  it('gives up after three attempts without sleeping after the last one', async () => {
    const { telnyx, calls, sleeps } = provider([{ status: 500 }, { status: 502 }, new Error('socket hang up')]);
    const error = await telnyx.getBalance().catch((e) => e);
    expect(error).toBeInstanceOf(TelephonyProviderError);
    expect(error.retryable).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does not sleep after the last attempt when every attempt answers 5xx', async () => {
    const { telnyx, calls, sleeps } = provider([{ status: 500 }, { status: 500 }, { status: 500 }]);
    await expect(telnyx.getBalance()).rejects.toMatchObject({ status: 500, retryable: true });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it('releases the connection of an error answer before retrying', async () => {
    let cancelled = 0;
    const errorBody = () => new ReadableStream({ cancel: () => void (cancelled += 1) });
    const replies = [new Response(errorBody(), { status: 503 }), new Response(errorBody(), { status: 422 })];
    const impl = (async () => replies.shift()!) as unknown as typeof fetch;
    const telnyx = new TelnyxProvider({ apiKey: 'k', credentialConnectionId: 'c', fetchImpl: impl, sleep: async () => {} });
    await expect(telnyx.getBalance()).rejects.toMatchObject({ status: 422 });
    expect(cancelled).toBe(2);
  });

  it('does not retry a 4xx, and never puts the API key or the response body in the error', async () => {
    const { telnyx, calls } = provider([{ status: 422, body: { errors: [{ detail: 'Bearer KEY_secret echoed' }] } }]);
    const error = await telnyx.command('ctl-1', { action: 'hangup' }, 'cmd-1').catch((e) => e);
    expect(error).toBeInstanceOf(TelephonyProviderError);
    expect(error.status).toBe(422);
    expect(error.retryable).toBe(false);
    expect(calls).toHaveLength(1);
    expect(String(error.message)).not.toMatch(/KEY_secret|echoed/);
  });

  it('treats a 404 on delete as already done', async () => {
    const { telnyx } = provider([{ status: 404 }, { status: 404 }]);
    await expect(telnyx.revokeCredential('gone')).resolves.toBeUndefined();
    await expect(telnyx.deleteRecording('gone')).resolves.toBeUndefined();
  });

  it('sends command_id with every call-control command and maps transfer fields', async () => {
    const { telnyx, calls } = provider([{ status: 200, body: { data: {} } }]);
    await telnyx.command('v3:ctl/1', { action: 'transfer', to: 'sip:gencred1@sip.telnyx.com', timeoutSecs: 20, clientState: 'abc' }, 'cmd-7');
    expect(calls[0].url).toBe('https://api.telnyx.com/v2/calls/v3%3Actl%2F1/actions/transfer');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      command_id: 'cmd-7',
      to: 'sip:gencred1@sip.telnyx.com',
      timeout_secs: 20,
      client_state: 'abc',
    });
  });

  it('returns null for a recording that no longer exists, and the mp3 link otherwise', async () => {
    const { telnyx } = provider([{ status: 404 }, { status: 200, body: { data: { download_urls: { mp3: 'https://x/r.mp3' } } } }]);
    await expect(telnyx.getRecordingUrl('r-1')).resolves.toBeNull();
    await expect(telnyx.getRecordingUrl('r-2')).resolves.toBe('https://x/r.mp3');
  });

  it('reads the balance as a number and refuses an answer without one', async () => {
    const { telnyx } = provider([
      { status: 200, body: { data: { available_credit: '42.50', currency: 'USD' } } },
      { status: 200, body: { data: {} } },
      { status: 200, body: '<html>maintenance</html>' },
    ]);
    await expect(telnyx.getBalance()).resolves.toEqual({ availableCredit: 42.5, currency: 'USD' });
    await expect(telnyx.getBalance()).rejects.toBeInstanceOf(TelephonyProviderError);
    await expect(telnyx.getBalance()).rejects.toBeInstanceOf(TelephonyProviderError);
  });

  it('refuses an empty token and a credential without an id', async () => {
    const { telnyx } = provider([{ status: 200, body: '  ' }, { status: 201, body: { data: { id: 'x' } } }]);
    await expect(telnyx.mintToken('cred-1')).rejects.toBeInstanceOf(TelephonyProviderError);
    await expect(telnyx.createCredential({ label: 'l', tag: 't' })).rejects.toBeInstanceOf(TelephonyProviderError);
  });
});
