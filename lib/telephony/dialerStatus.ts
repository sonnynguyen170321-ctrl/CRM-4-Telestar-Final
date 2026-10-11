/**
 * Whether the browser dialer is available to this rep, as a small store the Call button can wait on.
 *
 * Three states, not two: `unknown` (no answer yet) must not be read as "off", or a quick click routes to
 * the phone-call panel while the answer is still on its way. Only a positive answer is cached (a minute);
 * a negative or a failure is never kept, so a server flip is seen on the next ask, and a request already in
 * flight is shared. Client-safe; `fetchImpl` and the clock are injected for tests.
 */

export type DialerStatus = 'unknown' | 'enabled' | 'disabled';

export const POSITIVE_TTL_MS = 60_000;
/** How long the Call button waits for the answer before falling back to the panel. */
export const STATUS_WAIT_MS = 2_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type DialerStatusStore = {
  /** The last known answer, without asking. */
  peek(): DialerStatus;
  /** Ask (or reuse a fresh positive / in-flight answer). Never rejects. */
  refresh(): Promise<DialerStatus>;
  /** Resolves with the answer, or `disabled` if none arrives within `timeoutMs`. */
  resolve(timeoutMs?: number): Promise<DialerStatus>;
  subscribe(listener: (status: DialerStatus) => void): () => void;
};

export function createDialerStatusStore(deps: { fetchImpl?: Fetch; now?: () => number; setTimer?: (fn: () => void, ms: number) => unknown } = {}): DialerStatusStore {
  const doFetch: Fetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  let current: DialerStatus = 'unknown';
  let positiveAt = 0;
  let inFlight: Promise<DialerStatus> | null = null;
  const listeners = new Set<(status: DialerStatus) => void>();

  const set = (next: DialerStatus) => {
    const changed = next !== current;
    current = next;
    if (changed) listeners.forEach((listener) => listener(current));
  };

  const refresh = (): Promise<DialerStatus> => {
    if (current === 'enabled' && now() - positiveAt < POSITIVE_TTL_MS) return Promise.resolve(current);
    if (inFlight) return inFlight;
    inFlight = doFetch('/api/telephony/status', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body): DialerStatus => (body?.enabled === true ? 'enabled' : 'disabled'))
      .catch((): DialerStatus => 'disabled')
      .then((answer) => {
        if (answer === 'enabled') positiveAt = now();
        set(answer);
        inFlight = null;
        return answer;
      });
    return inFlight;
  };

  return {
    peek: () => current,
    refresh,
    resolve(timeoutMs = STATUS_WAIT_MS) {
      return new Promise<DialerStatus>((done) => {
        let settled = false;
        const finish = (value: DialerStatus) => {
          if (settled) return;
          settled = true;
          done(value);
        };
        setTimer(() => finish('disabled'), timeoutMs);
        void refresh().then(finish);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The one store the lead drawers share. */
export const dialerStatusStore = createDialerStatusStore();
