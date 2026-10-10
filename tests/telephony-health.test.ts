import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/auth', () => ({ auth: authMock, handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { TELEPHONY_ENV } from '@/lib/env-contract';
import { resetOpsAlertCooldown } from '@/lib/ops/notifyOps';
import { prisma } from '@/lib/prisma';
import { FakeTelephonyProvider } from '@/lib/telephony/fake';
import {
  BACKLOG_LIMIT,
  CONCURRENCY_RATIO,
  FAILURE_MIN_CALLS,
  FAILURE_RATE,
  FAILURE_WINDOW_MS,
  SILENCE_WINDOW_MS,
  checkTelephonyHealth,
  runTelephonyHealth,
} from '@/lib/telephony/health';
import { setTelephonyProviderForTests } from '@/lib/telephony/index';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import { GET } from '@/app/api/cron/telephony-health/route';
import { createTestTenant } from './helpers/testTenant';
import { asSystem, buildDialerWorld, deleteEventsWithPrefix, makeCall, storeEvent, type DialerWorld } from './helpers/telephonyFixture';

/**
 * The dialer's health cron (docs/dialer/TASKS.md D9.1). Every condition is judged at an injected `now`
 * in 2031, far from any row another suite writes, so the shared database cannot move a boundary.
 */

const NOW = new Date('2031-03-01T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const ENV_KEYS = [...TELEPHONY_ENV, 'TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN', 'TELNYX_BALANCE_ALERT_USD', 'TELNYX_CONCURRENCY_LIMIT', 'ALERT_WEBHOOK_URL', 'CRON_SECRET'] as const;

let savedEnv: Record<string, string | undefined> = {};
let provider: FakeTelephonyProvider;
let world: DialerWorld;
let tenantId: string;
const eventPrefix = `health-${randomUUID()}-`;
const fetchMock = vi.fn();

const keys = (findings: Array<{ key: string }>) => findings.map((finding) => finding.key);
const check = (overrides: Partial<Parameters<typeof checkTelephonyHealth>[0]> = {}) => checkTelephonyHealth({ now: NOW, provider, ...overrides });

async function placeCalls(count: number, failed: number, at = minutesAgo(5)) {
  for (let i = 0; i < count; i += 1) await makeCall(world, { status: i < failed ? 'failed' : 'completed', initiatedAt: at });
}

async function storeUnprocessed(count: number, receivedAt: Date) {
  for (let i = 0; i < count; i += 1) {
    await storeEvent({ id: `${eventPrefix}${randomUUID()}`, type: 'call.hangup', sessionId: `s-${randomUUID()}` }, { receivedAt, processedAt: null });
  }
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TELEPHONY_ENV) process.env[k] = `test-value-for-${k}-long-enough-to-satisfy-checks`;
  process.env.TELEPHONY_ENABLED = 'true';
  process.env.TELEPHONY_DRY_RUN = 'false';
  delete process.env.TELNYX_BALANCE_ALERT_USD;
  delete process.env.TELNYX_CONCURRENCY_LIMIT;
  delete process.env.ALERT_WEBHOOK_URL;
  provider = new FakeTelephonyProvider();
  setTelephonyProviderForTests(provider);
  resetOpsAlertCooldown();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  tenantId = `t-telhealth-${randomUUID()}`;
  await createTestTenant(tenantId, 'Health Test Team');
  world = await buildDialerWorld(tenantId);
  // Webhooks are arriving: the silence check stays out of every test that is not about silence.
  await storeEvent({ id: `${eventPrefix}heartbeat`, type: 'call.initiated', sessionId: 's-heartbeat' }, { receivedAt: minutesAgo(1), processedAt: minutesAgo(1) });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setTelephonyProviderForTests(null);
  authMock.mockReset();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  await deleteEventsWithPrefix(eventPrefix);
});

describe('a healthy dialer', () => {
  it('reports nothing', async () => {
    process.env.TELNYX_BALANCE_ALERT_USD = '20';
    process.env.TELNYX_CONCURRENCY_LIMIT = '40';
    await placeCalls(12, 1);
    await storeEvent({ id: `${eventPrefix}ok`, type: 'call.hangup', sessionId: 's-ok' }, { receivedAt: minutesAgo(1), processedAt: minutesAgo(1) });
    expect(await check()).toEqual([]);
  });

  it('does nothing while the dialer is off for the deployment', async () => {
    process.env.TELEPHONY_ENABLED = 'false';
    process.env.TELNYX_BALANCE_ALERT_USD = '500';
    await placeCalls(12, 12);
    expect(await check()).toEqual([]);
    expect(provider.balance.availableCredit).toBe(100);
  });
});

describe('balance', () => {
  beforeEach(() => {
    process.env.TELNYX_BALANCE_ALERT_USD = '20';
  });

  it('alerts below the threshold, not at it', async () => {
    provider.balance = { availableCredit: 19.99, currency: 'USD' };
    const below = await check();
    expect(keys(below)).toEqual(['telephony:balance']);
    expect(below[0]).toMatchObject({ level: 'fail' });
    expect(below[0].summary).toMatch(/balance/i);

    provider.balance = { availableCredit: 20, currency: 'USD' };
    expect(await check()).toEqual([]);
  });

  it('is skipped when no threshold is configured', async () => {
    delete process.env.TELNYX_BALANCE_ALERT_USD;
    provider.balance = { availableCredit: 0, currency: 'USD' };
    expect(await check()).toEqual([]);
  });

  it('says so when the balance cannot be read, rather than staying quiet', async () => {
    provider.failNext.getBalance = new TelephonyProviderError('down', 503, true);
    const findings = await check();
    expect(keys(findings)).toEqual(['telephony:balance-unavailable']);
    expect(findings[0].level).toBe('warn');
  });
});

describe('failure rate', () => {
  it('alerts above 20% with at least 10 calls in 15 minutes', async () => {
    await placeCalls(10, 3);
    const findings = await check();
    expect(keys(findings)).toEqual([`telephony:failure-rate:${tenantId}`]);
    expect(findings[0].summary).toContain('Health Test Team');
    expect(findings[0].details.join(' ')).toMatch(/3 of 10/);
  });

  it('does not alert at exactly 20%', async () => {
    expect(FAILURE_RATE).toBe(0.2);
    await placeCalls(10, 2);
    expect(await check()).toEqual([]);
  });

  it('does not alert under the minimum call count, however bad', async () => {
    expect(FAILURE_MIN_CALLS).toBe(10);
    await placeCalls(9, 9);
    expect(await check()).toEqual([]);
  });

  it('ignores calls older than the window and calls that never left (blocked)', async () => {
    expect(FAILURE_WINDOW_MS).toBe(15 * 60_000);
    await placeCalls(10, 10, minutesAgo(16));
    for (let i = 0; i < 10; i += 1) await makeCall(world, { status: 'blocked', initiatedAt: null });
    expect(await check()).toEqual([]);
  });

  it('judges each team on its own', async () => {
    const otherId = `t-telhealth-other-${randomUUID()}`;
    await createTestTenant(otherId, 'Quiet Team');
    const other = await buildDialerWorld(otherId);
    for (let i = 0; i < 10; i += 1) await makeCall(other, { status: 'completed', initiatedAt: minutesAgo(3) });
    await placeCalls(10, 5);
    const findings = await check();
    expect(keys(findings)).toEqual([`telephony:failure-rate:${tenantId}`]);
    expect(JSON.stringify(findings)).not.toContain('Quiet Team');
  });
});

describe('webhook silence', () => {
  it('alerts when calls were placed and no event arrived for 30 minutes', async () => {
    await deleteEventsWithPrefix(eventPrefix);
    await placeCalls(2, 0, minutesAgo(10));
    await storeEvent({ id: `${eventPrefix}old`, type: 'call.hangup', sessionId: 's-old' }, { receivedAt: minutesAgo(31), processedAt: minutesAgo(31) });
    const findings = await check();
    expect(keys(findings)).toEqual(['telephony:webhook-silence']);
    expect(findings[0].level).toBe('fail');
    expect(findings[0].details.join(' ')).toContain('Health Test Team');
  });

  it('stays quiet while events keep arriving, or when no call was placed', async () => {
    expect(SILENCE_WINDOW_MS).toBe(30 * 60_000);
    await storeEvent({ id: `${eventPrefix}fresh`, type: 'call.initiated', sessionId: 's-fresh' }, { receivedAt: minutesAgo(29), processedAt: minutesAgo(29) });
    await placeCalls(2, 0, minutesAgo(10));
    expect(await check()).toEqual([]);
    await deleteEventsWithPrefix(eventPrefix);
    expect(keys(await check())).toEqual(['telephony:webhook-silence']);

    await asSystem(() => prisma.call.deleteMany({ where: { tenantId } }));
    expect(await check()).toEqual([]);
  });
});

describe('event backlog', () => {
  it('alerts above 50 unprocessed events, not at 50', async () => {
    expect(BACKLOG_LIMIT).toBe(50);
    await storeUnprocessed(50, minutesAgo(10));
    expect(await check()).toEqual([]);
    await storeUnprocessed(1, minutesAgo(10));
    const findings = await check();
    expect(keys(findings)).toEqual(['telephony:backlog']);
    expect(findings[0].details.join(' ')).toMatch(/51/);
  });

  it('does not count events still on their way to being processed (under 2 minutes)', async () => {
    await storeUnprocessed(60, minutesAgo(1));
    expect(await check()).toEqual([]);
  });

  it('does not count processed events', async () => {
    for (let i = 0; i < 60; i += 1) {
      await storeEvent({ id: `${eventPrefix}p${i}`, type: 'call.hangup', sessionId: `s-p${i}` }, { receivedAt: minutesAgo(10), processedAt: minutesAgo(9) });
    }
    expect(await check()).toEqual([]);
  });
});

describe('concurrency', () => {
  const liveCalls = async (count: number) => {
    for (let i = 0; i < count; i += 1) await makeCall(world, { status: i % 2 ? 'answered' : 'ringing', initiatedAt: minutesAgo(1) });
  };

  it('alerts at 80% of the configured limit and above, not below', async () => {
    expect(CONCURRENCY_RATIO).toBe(0.8);
    process.env.TELNYX_CONCURRENCY_LIMIT = '10';
    await liveCalls(7);
    await storeEvent({ id: `${eventPrefix}live`, type: 'call.answered', sessionId: 's-live' }, { receivedAt: minutesAgo(1), processedAt: minutesAgo(1) });
    expect(await check()).toEqual([]);
    await liveCalls(1);
    const findings = await check();
    expect(keys(findings)).toEqual(['telephony:concurrency']);
    expect(findings[0].level).toBe('warn');
    expect(findings[0].details.join(' ')).toMatch(/8 of 10/);
  });

  it('is skipped when no limit is configured or the limit is not a positive number', async () => {
    await liveCalls(20);
    await storeEvent({ id: `${eventPrefix}live2`, type: 'call.answered', sessionId: 's-live2' }, { receivedAt: minutesAgo(1), processedAt: minutesAgo(1) });
    expect(await check()).toEqual([]);
    for (const bad of ['0', '-3', 'many', '']) {
      process.env.TELNYX_CONCURRENCY_LIMIT = bad;
      expect(await check()).toEqual([]);
    }
  });

  it('does not count finished calls', async () => {
    process.env.TELNYX_CONCURRENCY_LIMIT = '2';
    for (let i = 0; i < 5; i += 1) await makeCall(world, { status: 'completed', initiatedAt: minutesAgo(1) });
    await storeEvent({ id: `${eventPrefix}done`, type: 'call.hangup', sessionId: 's-done' }, { receivedAt: minutesAgo(1), processedAt: minutesAgo(1) });
    expect(await check()).toEqual([]);
  });
});

describe('alert text', () => {
  it('carries no phone number', async () => {
    process.env.TELNYX_BALANCE_ALERT_USD = '500';
    process.env.TELNYX_CONCURRENCY_LIMIT = '1';
    await placeCalls(12, 12, minutesAgo(5));
    await makeCall(world, { status: 'ringing', initiatedAt: minutesAgo(1) });
    await storeUnprocessed(60, minutesAgo(10));
    const findings = await check();
    expect(findings.length).toBeGreaterThanOrEqual(4);
    // The key carries the tenant id (a uuid, which can be all digits); the alert text is the summary and details.
    const text = JSON.stringify(findings.map(({ summary, details }) => ({ summary, details })));
    expect(text).not.toMatch(/\+?\d{7,}/);
    expect(text).not.toContain(world.toE164);
  });
});

describe('runTelephonyHealth: delivery and de-duplication', () => {
  beforeEach(() => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    process.env.TELNYX_BALANCE_ALERT_USD = '20';
    provider.balance = { availableCredit: 5, currency: 'USD' };
  });

  it('sends one message per finding', async () => {
    await placeCalls(10, 5);
    const summary = await runTelephonyHealth({ now: NOW, provider });
    expect(summary.findings).toHaveLength(2);
    expect(summary.notified).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const texts = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body).text as string);
    expect(texts.some((t) => /balance/i.test(t))).toBe(true);
    expect(texts.some((t) => t.includes('Health Test Team'))).toBe(true);
  });

  it('does not repeat the same condition on the next tick, and repeats it after the cooldown clears', async () => {
    await runTelephonyHealth({ now: NOW, provider });
    const second = await runTelephonyHealth({ now: new Date(NOW.getTime() + 5 * 60_000), provider });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.findings).toHaveLength(1);
    expect(second.notified).toBe(0);

    resetOpsAlertCooldown();
    await runTelephonyHealth({ now: new Date(NOW.getTime() + 10 * 60_000), provider });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a new condition still gets through while an old one is quiet', async () => {
    await runTelephonyHealth({ now: NOW, provider });
    await placeCalls(10, 6);
    await runTelephonyHealth({ now: NOW, provider });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws when the alert endpoint is down', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const summary = await runTelephonyHealth({ now: NOW, provider });
    expect(summary.findings).toHaveLength(1);
    expect(summary.notified).toBe(0);
  });

  it('survives one check failing, and says so', async () => {
    const spy = vi.spyOn(prisma.telephonyEvent, 'count').mockRejectedValue(new Error('db'));
    const findings = await check();
    spy.mockRestore();
    expect(keys(findings)).toContain('telephony:check-error:backlog');
    expect(keys(findings)).toContain('telephony:balance');
  });
});

describe('GET /api/cron/telephony-health', () => {
  const request = (authorization?: string) =>
    new NextRequest('https://crm.telestar.cloud/api/cron/telephony-health', { headers: authorization ? { authorization } : {} });

  beforeEach(() => {
    process.env.CRON_SECRET = 'health-cron-secret-for-tests';
    authMock.mockResolvedValue(null);
  });

  it('is 401 without the secret, with a wrong one, and with no secret configured', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer nope'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request('Bearer undefined'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a signed-in manager: it looks at every team', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'director', tenantId } });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(provider.balance.availableCredit).toBe(100);
  });

  it('runs for the scheduler and reports what it found', async () => {
    process.env.TELNYX_BALANCE_ALERT_USD = '500';
    const response = await GET(request('Bearer health-cron-secret-for-tests'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.findings).toContainEqual(expect.objectContaining({ key: 'telephony:balance', level: 'fail' }));
  });
});
