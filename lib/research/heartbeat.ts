/**
 * One serialized heartbeat lifecycle, shared by account and contact research.
 *
 * The account and contact engines used to carry near-identical copies of this loop, and they
 * had drifted: the account version woke the sleeping delay before awaiting the loop, the
 * contact version did not — so stopping contact research blocked for up to a full heartbeat
 * interval. There is one implementation now; do not reintroduce a second.
 *
 * `stop()` sets `alive = false`, cancels the timer, wakes the pending delay immediately, and
 * awaits loop termination. It never waits out the interval.
 */

export const HEARTBEAT_INTERVAL_MS = 60_000;

export interface ResearchHeartbeat {
  /** True once a renewal returned false or threw — the claim is no longer ours. */
  lost(): boolean;
  /** Stop the loop and await its termination. Idempotent. */
  stop(): Promise<void>;
}

/**
 * @param renew   Renews the claim. `false` means ownership was lost.
 * @param intervalMs Delay between renewals. Tests compress it; production uses the default.
 */
export function startResearchHeartbeat(
  renew: () => Promise<boolean>,
  intervalMs: number = HEARTBEAT_INTERVAL_MS
): ResearchHeartbeat {
  let alive = true;
  let lost = false;
  let timeoutId: NodeJS.Timeout | undefined;
  let wake: (() => void) | undefined;

  const delay = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timeoutId = setTimeout(resolve, intervalMs);
    });

  // The body runs synchronously up to the first `await`, so `wake` and `timeoutId` are set
  // before this function returns — a `stop()` on the very next line still cancels a real timer.
  const loop = (async () => {
    while (alive) {
      await delay();
      if (!alive) break;
      try {
        if (!(await renew())) {
          lost = true;
          alive = false;
        }
      } catch {
        lost = true;
        alive = false;
      }
    }
  })();

  return {
    lost: () => lost,
    async stop() {
      alive = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (wake) {
        wake();
        wake = undefined;
      }
      await loop;
    },
  };
}
