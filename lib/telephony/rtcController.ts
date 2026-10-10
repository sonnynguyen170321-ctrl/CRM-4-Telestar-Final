import type { TabLock } from './tabLock';

/**
 * The browser's one Telnyx client (docs/dialer/TASKS.md D5.1), without React so it can be tested with
 * a mocked SDK. `components/dialer/useTelnyxClient.ts` is the thin hook around it.
 *
 * It owns: the tab lock (one client per browser), the login token (fetched from our API, refreshed
 * before it expires and on the SDK's 34001 warning), the registration status, and a clean
 * disconnect. A refresh swaps the client for one with the new token, so it waits while a call is up
 * — established media does not need the token, and dropping a live call to refresh would be worse
 * than the token running out a little later.
 *
 * The SDK is loaded lazily through `loadSdk`, so a page that never opens the dialer does not ship it.
 */

export type RtcCallLike = {
  readonly state: string;
  hangup(): unknown;
  muteAudio(): unknown;
  unmuteAudio(): unknown;
  hold(): unknown;
  unhold(): unknown;
  dtmf(digit: string): unknown;
  setAudioOutDevice?(deviceId: string): unknown;
  setAudioInDevice?(deviceId: string): unknown;
};

export type NewCallOptions = {
  destinationNumber: string;
  callerNumber?: string;
  /** The call token from POST /api/telephony/calls, base64 (`toClientState`): the webhook checks it. */
  clientState: string;
  audio: boolean;
  remoteElement?: HTMLMediaElement | string;
  micId?: string;
  speakerId?: string;
};

export type RtcClientLike = {
  on(event: string, listener: (payload: never) => void): unknown;
  off?(event: string, listener?: (payload: never) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
  newCall(options: NewCallOptions): RtcCallLike;
  getAudioInDevices?(): Promise<MediaDeviceInfo[]>;
  getAudioOutDevices?(): Promise<MediaDeviceInfo[]>;
};

export type ClientFactory = (options: { login_token: string }) => RtcClientLike;

export type RtcStatus = 'idle' | 'locked' | 'connecting' | 'registered' | 'error';

export type RtcSnapshot = { status: RtcStatus; error: string | null };

export type TokenResult = { token: string; expiresAt: string };

export type TokenFetcher = () => Promise<{ ok: true; token: TokenResult } | { ok: false; message: string; code?: string }>;

/** The SDK warns with this code when the login token is about to run out. */
export const TOKEN_EXPIRING_SOON = 34001;
/** Refresh this long before the token's own expiry. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Never refresh sooner than this, so a token that is already near expiry cannot loop. */
export const TOKEN_REFRESH_MIN_MS = 30 * 1000;

export function msUntilTokenRefresh(expiresAtIso: string, nowMs: number): number {
  const expiresAt = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAt)) return TOKEN_REFRESH_MIN_MS;
  return Math.max(TOKEN_REFRESH_MIN_MS, expiresAt - nowMs - TOKEN_REFRESH_MARGIN_MS);
}

type WarningPayload = { code?: number } | undefined;
type ErrorPayload = { error?: { message?: string } | string; message?: string } | undefined;

export type RtcController = {
  start(): Promise<void>;
  stop(): void;
  /** Tell the controller whether a call is up, so a due refresh waits for it. */
  setCallActive(active: boolean): void;
  refreshNow(): Promise<void>;
  getClient(): RtcClientLike | null;
  getSnapshot(): RtcSnapshot;
  subscribe(listener: (snapshot: RtcSnapshot) => void): () => void;
};

export function createRtcController(deps: {
  loadClientFactory: () => Promise<ClientFactory>;
  fetchToken: TokenFetcher;
  lock: TabLock;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): RtcController {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let snapshot: RtcSnapshot = { status: 'idle', error: null };
  const listeners = new Set<(snapshot: RtcSnapshot) => void>();
  let client: RtcClientLike | null = null;
  let refreshTimer: unknown = null;
  let refreshDue = false;
  let callActive = false;
  let stopped = true;
  let starting: Promise<void> | null = null;
  let generation = 0;

  const publish = (next: RtcSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  };

  const dropClient = () => {
    const old = client;
    client = null;
    if (!old) return;
    try {
      old.disconnect();
    } catch {
      // Already gone; nothing else to clean up.
    }
  };

  const clearRefresh = () => {
    if (refreshTimer !== null) clearTimer(refreshTimer);
    refreshTimer = null;
  };

  const scheduleRefresh = (expiresAt: string) => {
    clearRefresh();
    refreshTimer = setTimer(() => void requestRefresh(), msUntilTokenRefresh(expiresAt, now()));
  };

  async function requestRefresh() {
    if (stopped) return;
    if (callActive) {
      refreshDue = true;
      return;
    }
    refreshDue = false;
    await connectWithFreshToken();
  }

  async function connectWithFreshToken() {
    const mine = ++generation;
    publish({ status: 'connecting', error: null });
    const result = await deps.fetchToken();
    if (stopped || mine !== generation) return;
    if (!result.ok) {
      dropClient();
      publish({ status: 'error', error: result.message });
      return;
    }
    let factory: ClientFactory;
    try {
      factory = await deps.loadClientFactory();
    } catch {
      if (!stopped && mine === generation) publish({ status: 'error', error: 'The phone software could not be loaded. Reload the page and try again.' });
      return;
    }
    if (stopped || mine !== generation) return;

    dropClient();
    const next = factory({ login_token: result.token.token });
    client = next;
    next.on('telnyx.ready', (() => {
      if (client === next && mine === generation) publish({ status: 'registered', error: null });
    }) as (payload: never) => void);
    next.on('telnyx.error', ((payload: ErrorPayload) => {
      if (client !== next || mine !== generation) return;
      const raw = payload?.error;
      const message = (typeof raw === 'string' ? raw : raw?.message) ?? payload?.message ?? 'The phone connection failed.';
      publish({ status: 'error', error: message });
    }) as (payload: never) => void);
    next.on('telnyx.warning', ((payload: WarningPayload) => {
      if (client === next && payload?.code === TOKEN_EXPIRING_SOON) void requestRefresh();
    }) as (payload: never) => void);
    scheduleRefresh(result.token.expiresAt);
    next.connect();
  }

  return {
    async start() {
      if (!stopped && starting) return starting;
      stopped = false;
      starting = (async () => {
        const owned = await deps.lock.acquire();
        if (stopped) {
          if (owned) deps.lock.release();
          return;
        }
        if (!owned) {
          publish({ status: 'locked', error: null });
          return;
        }
        await connectWithFreshToken();
      })();
      try {
        await starting;
      } finally {
        starting = null;
      }
    },
    stop() {
      stopped = true;
      generation += 1;
      clearRefresh();
      dropClient();
      deps.lock.release();
      publish({ status: 'idle', error: null });
    },
    setCallActive(active) {
      callActive = active;
      if (!active && refreshDue) void requestRefresh();
    },
    refreshNow: () => requestRefresh(),
    getClient: () => client,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
