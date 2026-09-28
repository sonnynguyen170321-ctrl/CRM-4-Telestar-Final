import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { notifyOps, formatOpsAlert, resetOpsAlertCooldown } from '@/lib/ops/notifyOps';

/**
 * The alerter must reach a person, must never break what it is watching, and must not cry wolf.
 *
 * Before this module every detector in the codebase ended somewhere nobody looks: `console.error`
 * into `docker logs`, `logger -t crm` into a syslog nothing reads, a `Notification` row visible only
 * on the next full page load. A repo-wide search for slack / pagerduty / sentry / any alert webhook
 * returned nothing at all. So when the worker stopped, every page still loaded and every button
 * still answered 200.
 *
 * These tests hold the three properties that make it trustworthy rather than decorative.
 */

const originalUrl = process.env.ALERT_WEBHOOK_URL;
const originalLabel = process.env.ALERT_ENV_LABEL;

describe('notifyOps', () => {
  beforeEach(() => {
    resetOpsAlertCooldown();
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/abc';
    delete process.env.ALERT_ENV_LABEL;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = originalUrl;
    if (originalLabel === undefined) delete process.env.ALERT_ENV_LABEL;
    else process.env.ALERT_ENV_LABEL = originalLabel;
  });

  it('posts the alert and reports that a human was reached', async () => {
    // Variadic on purpose: `vi.fn(async () => …)` types as taking no arguments, so
    // `mock.calls[0][1]` would not type-check even though the call happens.
    const fetchMock = vi.fn(async (_url?: unknown, _init?: RequestInit) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const delivered = await notifyOps({
      key: 'worker-healthcheck',
      level: 'fail',
      summary: 'CRM worker did not execute a health check job',
      details: ['enqueue ok, never completed'],
    });

    expect(delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toContain('did not execute a health check job');
    expect(body.text).toContain('enqueue ok, never completed');
  });

  it('says a human was NOT reached when no webhook is configured', async () => {
    // The point of the return value. Callers log "this reached nobody" instead of assuming
    // delivery — which is the exact assumption the rest of the system used to make.
    delete process.env.ALERT_WEBHOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const delivered = await notifyOps({ key: 'k', level: 'fail', summary: 'something broke' });

    expect(delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // Still written locally, so an unconfigured webhook degrades to today's behaviour rather than
    // losing the finding.
    expect(console.error).toHaveBeenCalled();
  });

  it('never throws when the webhook is down, and allows an immediate retry', async () => {
    // An alerter that can fail the thing it watches is worse than no alerter.
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(notifyOps({ key: 'k', level: 'fail', summary: 'x' })).resolves.toBe(false);

    // A failed post does not burn the cooldown — otherwise one outage of the webhook would silence
    // the next 30 minutes of real alerts.
    vi.stubGlobal('fetch', vi.fn(async (_url?: unknown, _init?: RequestInit) => new Response('ok', { status: 200 })));
    await expect(notifyOps({ key: 'k', level: 'fail', summary: 'x' })).resolves.toBe(true);
  });

  it('reports a non-2xx as undelivered rather than as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url?: unknown, _init?: RequestInit) => new Response('nope', { status: 500 })));

    await expect(notifyOps({ key: 'k', level: 'warn', summary: 'x' })).resolves.toBe(false);
  });

  it('stays quiet on the same condition inside the cooldown', async () => {
    // A condition checked every five minutes would otherwise page someone every five minutes, and
    // the second message teaches nobody anything the first did not.
    // Variadic on purpose: `vi.fn(async () => …)` types as taking no arguments, so
    // `mock.calls[0][1]` would not type-check even though the call happens.
    const fetchMock = vi.fn(async (_url?: unknown, _init?: RequestInit) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyOps({ key: 'same', level: 'fail', summary: 'first' });
    await notifyOps({ key: 'same', level: 'fail', summary: 'second' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not let one condition silence a different one', async () => {
    // Variadic on purpose: `vi.fn(async () => …)` types as taking no arguments, so
    // `mock.calls[0][1]` would not type-check even though the call happens.
    const fetchMock = vi.fn(async (_url?: unknown, _init?: RequestInit) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyOps({ key: 'worker', level: 'fail', summary: 'a' });
    await notifyOps({ key: 'capacity', level: 'warn', summary: 'b' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('labels the environment when asked, so staging cannot be mistaken for production', () => {
    process.env.ALERT_ENV_LABEL = 'staging';
    expect(formatOpsAlert({ key: 'k', level: 'fail', summary: 'disk full' })).toContain('[staging]');
  });
});
