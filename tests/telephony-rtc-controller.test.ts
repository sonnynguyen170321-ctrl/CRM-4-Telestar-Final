import { describe, expect, it, vi } from 'vitest';

import {
  createRtcController,
  msUntilTokenRefresh,
  TOKEN_EXPIRING_SOON,
  TOKEN_REFRESH_MARGIN_MS,
  TOKEN_REFRESH_MIN_MS,
  type RtcClientLike,
  type TokenFetcher,
} from '@/lib/telephony/rtcController';
import { createTabLock, type ChannelLike, type LockMessage } from '@/lib/telephony/tabLock';

/**
 * The browser's one Telnyx client, against a mocked SDK: the tab lock, the token and its refresh,
 * registration status and a clean disconnect. No network, no real timers.
 */

// ── a BroadcastChannel stand-in: every channel on the bus hears every other one ──
function makeBus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements ChannelLike {
    private listeners = new Set<(event: { data: LockMessage }) => void>();
    closed = false;
    constructor() {
      channels.add(this);
    }
    postMessage(message: LockMessage) {
      for (const other of channels) if (other !== this && !other.closed) other.listeners.forEach((l) => l({ data: message }));
    }
    addEventListener(_: 'message', listener: (event: { data: LockMessage }) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_: 'message', listener: (event: { data: LockMessage }) => void) {
      this.listeners.delete(listener);
    }
    close() {
      this.closed = true;
      channels.delete(this);
    }
  }
  return { open: () => new FakeChannel() };
}

/** A scheduler that runs when told to, so lock waits and refresh timers are deterministic. */
function makeClock() {
  let nowMs = Date.parse('2026-10-10T10:00:00Z');
  const timers: Array<{ at: number; fn: () => void; id: number; cancelled: boolean }> = [];
  let nextId = 1;
  return {
    now: () => nowMs,
    setTimer: (fn: () => void, ms: number) => {
      const timer = { at: nowMs + ms, fn, id: nextId++, cancelled: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimer: (id: unknown) => {
      const timer = timers.find((t) => t.id === id);
      if (timer) timer.cancelled = true;
    },
    pending: () => timers.filter((t) => !t.cancelled && t.at >= 0 && !('done' in t)).length,
    async advance(ms: number) {
      nowMs += ms;
      for (const timer of timers.filter((t) => !t.cancelled && t.at <= nowMs)) {
        timer.cancelled = true;
        timer.fn();
      }
      await flush();
    },
    /** Fires every scheduled timer regardless of time (the lock's 200 ms wait). */
    async fireAll() {
      for (const timer of timers.filter((t) => !t.cancelled)) {
        timer.cancelled = true;
        timer.fn();
      }
      await flush();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

type FakeClient = RtcClientLike & {
  options: { login_token: string };
  handlers: Map<string, (payload: unknown) => void>;
  emit(event: string, payload?: unknown): void;
  disconnected: boolean;
  connected: boolean;
};

function makeSdk() {
  const clients: FakeClient[] = [];
  const factory = (options: { login_token: string }): RtcClientLike => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const client: FakeClient = {
      options,
      handlers,
      disconnected: false,
      connected: false,
      on: (event, listener) => void handlers.set(event, listener as (payload: unknown) => void),
      connect() {
        client.connected = true;
      },
      disconnect() {
        client.disconnected = true;
      },
      newCall: vi.fn(),
      emit: (event, payload) => handlers.get(event)?.(payload),
    };
    clients.push(client);
    return client;
  };
  return { clients, factory, loadClientFactory: vi.fn(async () => factory) };
}

function makeTokens(expiresInMs = 24 * 60 * 60 * 1000, nowMs = Date.parse('2026-10-10T10:00:00Z')): { fetchToken: TokenFetcher; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    fetchToken: async () => {
      n += 1;
      return { ok: true, token: { token: `jwt-${n}`, expiresAt: new Date(nowMs + expiresInMs).toISOString() } };
    },
  };
}

function setup(opts: { bus?: ReturnType<typeof makeBus>; id?: string; tokens?: ReturnType<typeof makeTokens>; sdk?: ReturnType<typeof makeSdk> } = {}) {
  const bus = opts.bus ?? makeBus();
  const clock = makeClock();
  const sdk = opts.sdk ?? makeSdk();
  const tokens = opts.tokens ?? makeTokens();
  const lock = createTabLock({ channelFactory: () => bus.open(), id: opts.id ?? 'tab-a', schedule: clock.setTimer });
  const controller = createRtcController({
    loadClientFactory: sdk.loadClientFactory,
    fetchToken: tokens.fetchToken,
    lock,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { bus, clock, sdk, tokens, lock, controller };
}

/** start() waits on the lock's timer, so fire it while start is pending. */
async function startAndSettle(env: ReturnType<typeof setup>) {
  const started = env.controller.start();
  await flush();
  await env.clock.fireAll();
  await started;
  await flush();
}

describe('the browser\'s one client', () => {
  it('logs in with a fresh token, and is registered once the SDK says ready', async () => {
    const env = setup();
    await startAndSettle(env);

    expect(env.sdk.loadClientFactory).toHaveBeenCalledTimes(1);
    expect(env.sdk.clients).toHaveLength(1);
    expect(env.sdk.clients[0].options).toEqual({ login_token: 'jwt-1' });
    expect(env.sdk.clients[0].connected).toBe(true);
    expect(env.controller.getSnapshot()).toEqual({ status: 'connecting', error: null });

    env.sdk.clients[0].emit('telnyx.ready');
    expect(env.controller.getSnapshot()).toEqual({ status: 'registered', error: null });
    expect(env.controller.getClient()).toBe(env.sdk.clients[0]);
  });

  it('reports an SDK error, from either shape of payload', async () => {
    const env = setup();
    await startAndSettle(env);
    env.sdk.clients[0].emit('telnyx.error', { error: { message: 'Login failed' } });
    expect(env.controller.getSnapshot()).toEqual({ status: 'error', error: 'Login failed' });
    env.sdk.clients[0].emit('telnyx.error', { message: 'Socket closed' });
    expect(env.controller.getSnapshot().error).toBe('Socket closed');
  });

  it('reports a failed token request and creates no client', async () => {
    const env = setup({ tokens: { calls: () => 0, fetchToken: async () => ({ ok: false, message: 'The dialer is switched off for this team' }) } });
    await startAndSettle(env);
    expect(env.controller.getSnapshot()).toEqual({ status: 'error', error: 'The dialer is switched off for this team' });
    expect(env.sdk.clients).toHaveLength(0);
  });

  it('reports an SDK that fails to load', async () => {
    const sdk = makeSdk();
    sdk.loadClientFactory.mockRejectedValueOnce(new Error('chunk failed'));
    const env = setup({ sdk });
    await startAndSettle(env);
    expect(env.controller.getSnapshot().status).toBe('error');
    expect(env.controller.getSnapshot().error).toMatch(/could not be loaded/);
  });

  it('does not load the SDK at all until started', () => {
    const env = setup();
    expect(env.sdk.loadClientFactory).not.toHaveBeenCalled();
    expect(env.controller.getSnapshot().status).toBe('idle');
  });

  it('disconnects the client and releases the lock on stop, and a stop mid-start leaves no client behind', async () => {
    const env = setup();
    await startAndSettle(env);
    env.controller.stop();
    expect(env.sdk.clients[0].disconnected).toBe(true);
    expect(env.lock.isHeld).toBe(false);
    expect(env.controller.getSnapshot().status).toBe('idle');
    expect(env.controller.getClient()).toBeNull();

    const early = setup();
    const started = early.controller.start();
    early.controller.stop();
    await early.clock.fireAll();
    await started;
    expect(early.sdk.clients).toHaveLength(0);
    expect(early.lock.isHeld).toBe(false);
  });
});

describe('one client per browser: the tab lock', () => {
  it('shows a second tab as locked, and creates no client or token for it', async () => {
    const bus = makeBus();
    const first = setup({ bus, id: 'tab-a' });
    await startAndSettle(first);
    expect(first.controller.getSnapshot().status).toBe('connecting');

    const second = setup({ bus, id: 'tab-b' });
    await startAndSettle(second);
    expect(second.controller.getSnapshot()).toEqual({ status: 'locked', error: null });
    expect(second.sdk.clients).toHaveLength(0);
    expect(second.tokens.calls()).toBe(0);
  });

  it('lets the second tab take over after the first one stops', async () => {
    const bus = makeBus();
    const first = setup({ bus, id: 'tab-a' });
    await startAndSettle(first);
    const second = setup({ bus, id: 'tab-b' });
    const released = vi.fn();
    second.lock.onReleased(released);
    await startAndSettle(second);
    expect(second.controller.getSnapshot().status).toBe('locked');

    first.controller.stop();
    expect(released).toHaveBeenCalledTimes(1);
    await startAndSettle(second);
    expect(second.sdk.clients).toHaveLength(1);
    expect(second.controller.getSnapshot().status).toBe('connecting');
  });

  it('settles two tabs opened at the same moment on exactly one owner', async () => {
    const bus = makeBus();
    const a = setup({ bus, id: 'tab-a' });
    const b = setup({ bus, id: 'tab-b' });
    const startedA = a.controller.start();
    const startedB = b.controller.start();
    await flush();
    await a.clock.fireAll();
    await b.clock.fireAll();
    await Promise.all([startedA, startedB]);
    await flush();
    const owners = [a, b].filter((env) => env.lock.isHeld);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(a);
    expect(b.controller.getSnapshot().status).toBe('locked');
  });

  it('owns the lock when the browser has no BroadcastChannel', async () => {
    const clock = makeClock();
    const lock = createTabLock({ channelFactory: () => null, id: 'solo', schedule: clock.setTimer });
    await expect(lock.acquire()).resolves.toBe(true);
    expect(lock.isHeld).toBe(true);
  });
});

describe('token refresh', () => {
  it('schedules the refresh five minutes before the token expires', () => {
    const now = Date.parse('2026-10-10T10:00:00Z');
    const in24h = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    expect(msUntilTokenRefresh(in24h, now)).toBe(24 * 60 * 60 * 1000 - TOKEN_REFRESH_MARGIN_MS);
  });

  it('never refreshes in a tight loop, even for a token that is already near expiry or unreadable', () => {
    const now = Date.parse('2026-10-10T10:00:00Z');
    expect(msUntilTokenRefresh(new Date(now + 1000).toISOString(), now)).toBe(TOKEN_REFRESH_MIN_MS);
    expect(msUntilTokenRefresh(new Date(now - 1000).toISOString(), now)).toBe(TOKEN_REFRESH_MIN_MS);
    expect(msUntilTokenRefresh('garbage', now)).toBe(TOKEN_REFRESH_MIN_MS);
  });

  it('swaps in a client with a new token when the refresh timer fires', async () => {
    const env = setup({ tokens: makeTokens(60 * 60 * 1000) });
    await startAndSettle(env);
    env.sdk.clients[0].emit('telnyx.ready');

    await env.clock.advance(60 * 60 * 1000 - TOKEN_REFRESH_MARGIN_MS + 1);
    expect(env.tokens.calls()).toBe(2);
    expect(env.sdk.clients).toHaveLength(2);
    expect(env.sdk.clients[0].disconnected).toBe(true);
    expect(env.sdk.clients[1].options.login_token).toBe('jwt-2');

    // The old client's late events no longer move the status.
    env.sdk.clients[1].emit('telnyx.ready');
    env.sdk.clients[0].emit('telnyx.error', { message: 'late' });
    expect(env.controller.getSnapshot()).toEqual({ status: 'registered', error: null });
  });

  it('refreshes at once on the SDK\'s 34001 warning, and ignores other warnings', async () => {
    const env = setup();
    await startAndSettle(env);
    env.sdk.clients[0].emit('telnyx.warning', { code: 31001 });
    await flush();
    expect(env.tokens.calls()).toBe(1);

    env.sdk.clients[0].emit('telnyx.warning', { code: TOKEN_EXPIRING_SOON });
    await flush();
    expect(env.tokens.calls()).toBe(2);
    expect(env.sdk.clients).toHaveLength(2);
    expect(env.sdk.clients[1].options.login_token).toBe('jwt-2');
  });

  it('waits for a call to end before swapping the client, then refreshes', async () => {
    const env = setup();
    await startAndSettle(env);
    env.controller.setCallActive(true);

    env.sdk.clients[0].emit('telnyx.warning', { code: TOKEN_EXPIRING_SOON });
    await flush();
    expect(env.tokens.calls()).toBe(1);
    expect(env.sdk.clients[0].disconnected).toBe(false);

    env.controller.setCallActive(false);
    await flush();
    expect(env.tokens.calls()).toBe(2);
    expect(env.sdk.clients[0].disconnected).toBe(true);
  });

  it('does not refresh after stop', async () => {
    const env = setup({ tokens: makeTokens(60 * 60 * 1000) });
    await startAndSettle(env);
    env.controller.stop();
    await env.clock.advance(2 * 60 * 60 * 1000);
    expect(env.tokens.calls()).toBe(1);
    expect(env.sdk.clients).toHaveLength(1);
  });

  it('keeps a failed refresh visible instead of silently running on a dead token', async () => {
    let calls = 0;
    const env = setup({
      tokens: {
        calls: () => calls,
        fetchToken: async () => {
          calls += 1;
          return calls === 1
            ? { ok: true, token: { token: 'jwt-1', expiresAt: new Date(Date.parse('2026-10-10T10:00:00Z') + 3_600_000).toISOString() } }
            : { ok: false, message: 'The phone provider is not answering' };
        },
      },
    });
    await startAndSettle(env);
    env.sdk.clients[0].emit('telnyx.warning', { code: TOKEN_EXPIRING_SOON });
    await flush();
    expect(env.controller.getSnapshot()).toEqual({ status: 'error', error: 'The phone provider is not answering' });
  });
});

describe('subscribing', () => {
  it('notifies listeners of each status change, and stops after unsubscribe', async () => {
    const env = setup();
    const seen: string[] = [];
    const unsubscribe = env.controller.subscribe((s) => seen.push(s.status));
    await startAndSettle(env);
    env.sdk.clients[0].emit('telnyx.ready');
    unsubscribe();
    env.controller.stop();
    expect(seen).toEqual(['connecting', 'registered']);
  });
});
