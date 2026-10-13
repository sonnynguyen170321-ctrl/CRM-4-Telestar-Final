import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createDialerStatusStore, POSITIVE_TTL_MS, STATUS_WAIT_MS } from '@/lib/telephony/dialerStatus';

/** The Call button's dialer status: unknown until answered, no stale negative, and the combined call screen's wiring. */

const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

function clock() {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => void timers.push({ at: t + ms, fn }),
    advance(ms: number) {
      t += ms;
      timers.filter((x) => x.at <= t).forEach((x) => x.fn());
    },
  };
}

describe('dialer status store', () => {
  it('starts unknown and becomes enabled when the server says so', async () => {
    const store = createDialerStatusStore({ fetchImpl: answer(200, { enabled: true }) });
    expect(store.peek()).toBe('unknown');
    expect(await store.refresh()).toBe('enabled');
    expect(store.peek()).toBe('enabled');
  });

  it('is disabled on a "no", a server error and a network failure', async () => {
    expect(await createDialerStatusStore({ fetchImpl: answer(200, { enabled: false }) }).refresh()).toBe('disabled');
    expect(await createDialerStatusStore({ fetchImpl: answer(500, {}) }).refresh()).toBe('disabled');
    expect(
      await createDialerStatusStore({
        fetchImpl: async () => {
          throw new Error('offline');
        },
      }).refresh()
    ).toBe('disabled');
  });

  it('never keeps a negative: the next ask goes back to the server and sees a flip', async () => {
    let enabled = false;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ enabled })));
    const store = createDialerStatusStore({ fetchImpl });
    expect(await store.refresh()).toBe('disabled');
    enabled = true;
    expect(await store.refresh()).toBe('enabled');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reuses a positive for a minute, then asks again and can turn off', async () => {
    const c = clock();
    let enabled = true;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ enabled })));
    const store = createDialerStatusStore({ fetchImpl, now: c.now });
    await store.refresh();
    await store.refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    c.advance(POSITIVE_TTL_MS + 1);
    enabled = false;
    expect(await store.refresh()).toBe('disabled');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one request among simultaneous askers', async () => {
    const fetchImpl = vi.fn(answer(200, { enabled: true }));
    const store = createDialerStatusStore({ fetchImpl });
    await Promise.all([store.refresh(), store.refresh(), store.resolve()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolve() gives the answer, or disabled after the wait when the server is too slow', async () => {
    expect(await createDialerStatusStore({ fetchImpl: answer(200, { enabled: true }) }).resolve()).toBe('enabled');

    const c = clock();
    const slow = createDialerStatusStore({ fetchImpl: () => new Promise<Response>(() => {}), setTimer: c.setTimer });
    const pending = slow.resolve();
    c.advance(STATUS_WAIT_MS);
    expect(await pending).toBe('disabled');
    expect(slow.peek()).toBe('unknown');
  });

  it('tells subscribers about changes only', async () => {
    const store = createDialerStatusStore({ fetchImpl: answer(200, { enabled: true }) });
    const seen: string[] = [];
    const off = store.subscribe((s) => seen.push(s));
    await store.refresh();
    off();
    expect(seen).toEqual(['enabled']);
  });
});

describe('the combined call screen is wired both ways', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

  it('the docked dialer hands over to the drawer panel (QR, log a call made on the phone) for the rep’s own phone', () => {
    const dock = read('components', 'dialer', 'DockedDialer.tsx');
    expect(dock).toContain('Use my own phone');
    expect(dock).toContain('OWN_PHONE_EVENT');
    expect(read('components', 'dialer', 'PhoneCallPanel.tsx')).toContain('PhoneQrBlock');
  });

  it('the phone panel offers the way back, only when given the handler', () => {
    const panel = read('components', 'dialer', 'PhoneCallPanel.tsx');
    expect(panel).toContain('Call from CRM instead');
    expect(panel).toMatch(/\{onCallFromCrm && \(/);
  });

  it('the drawer waits for the status, routes on it, and switches both ways', () => {
    const drawer = read('components', 'LeadDetailPanel.tsx');
    expect(drawer).toContain('dialerStatus.resolve()');
    expect(drawer).toContain('dialerStatus: answer');
    expect(drawer).toContain('dialerDock.open(');
    expect(drawer).toContain('OWN_PHONE_EVENT');
    expect(drawer).toContain('onCallFromCrm=');
    expect(drawer).not.toContain('useDialerEnabled');
  });

  it('refetches the status when the window regains focus', () => {
    expect(read('components', 'dialer', 'useDialerStatus.ts')).toContain("addEventListener('focus'");
  });
});
