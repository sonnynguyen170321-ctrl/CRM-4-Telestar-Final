/**
 * One softphone per browser (docs/dialer/ARCHITECTURE.md): two tabs registering the same credential
 * would fight over the call and double-ring. A BroadcastChannel lock decides which tab owns it.
 *
 * Protocol, on one channel per origin:
 *   - a tab that wants the lock posts `claim` and listens for `held` for `waitMs`;
 *   - the tab that owns the lock answers every `claim` with `held`;
 *   - a tab still waiting that sees another `claim` keeps the lock for the lower id (answering `held`
 *     to a higher one), so two tabs opened together settle on one owner instead of both winning;
 *   - the owner posts `released` when it lets go, so a waiting tab can try again.
 *
 * Client-safe and framework-free: the channel is injected so the logic is a unit test.
 */

export type LockMessage = { type: 'claim' | 'held' | 'released'; from: string };

export type ChannelLike = {
  postMessage(message: LockMessage): void;
  addEventListener(type: 'message', listener: (event: { data: LockMessage }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: LockMessage }) => void): void;
  close(): void;
};

export type TabLock = {
  /** True when this tab now owns the lock. */
  acquire(): Promise<boolean>;
  release(): void;
  readonly isHeld: boolean;
  /** Called when another tab releases the lock; a locked-out tab can offer a retry. */
  onReleased(listener: () => void): () => void;
};

export const TAB_LOCK_CHANNEL = 'telestar-softphone';
export const TAB_LOCK_WAIT_MS = 200;

export function createTabLock(options: {
  channelFactory: () => ChannelLike | null;
  id: string;
  waitMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
}): TabLock {
  const waitMs = options.waitMs ?? TAB_LOCK_WAIT_MS;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  let channel: ChannelLike | null = null;
  let held = false;
  let claiming = false;
  let lostClaim = false;
  const releasedListeners = new Set<() => void>();

  const handle = (event: { data: LockMessage }) => {
    const message = event.data;
    if (!message || message.from === options.id) return;
    if (message.type === 'claim') {
      // The owner answers; so does a tab that is still claiming but outranks the claimant, which may
      // have opened its channel after this tab's claim went out and never heard it.
      if (held || (claiming && !lostClaim && message.from > options.id)) channel?.postMessage({ type: 'held', from: options.id });
      else if (claiming && message.from < options.id) lostClaim = true;
    } else if (message.type === 'held') {
      if (claiming) lostClaim = true;
    } else if (message.type === 'released') {
      releasedListeners.forEach((listener) => listener());
    }
  };

  const open = () => {
    if (channel) return channel;
    channel = options.channelFactory();
    channel?.addEventListener('message', handle);
    return channel;
  };

  return {
    get isHeld() {
      return held;
    },
    acquire() {
      if (held) return Promise.resolve(true);
      const current = open();
      // No BroadcastChannel (very old browser): nothing to coordinate with, so this tab owns it.
      if (!current) {
        held = true;
        return Promise.resolve(true);
      }
      claiming = true;
      lostClaim = false;
      current.postMessage({ type: 'claim', from: options.id });
      return new Promise<boolean>((resolve) => {
        schedule(() => {
          claiming = false;
          held = !lostClaim;
          resolve(held);
        }, waitMs);
      });
    },
    release() {
      if (held) channel?.postMessage({ type: 'released', from: options.id });
      held = false;
      claiming = false;
      channel?.removeEventListener('message', handle);
      channel?.close();
      channel = null;
    },
    onReleased(listener) {
      releasedListeners.add(listener);
      return () => releasedListeners.delete(listener);
    },
  };
}
