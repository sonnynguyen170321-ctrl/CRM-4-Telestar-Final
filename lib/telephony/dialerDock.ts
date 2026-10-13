import type { DialTarget } from './dialerTargets';

/**
 * The docked dialer's open/closed state, as a small store any page can drive without a provider tree:
 * the lead drawer's Call button, the top bar button and Alt+Shift+D all call into it, and the one dock mounted
 * by `ClientLayoutAddons` listens. Client-safe and framework-free so the transitions are unit-tested.
 *
 * Each request carries a `seq` so the dock can tell "the same target again" from "a new request", and a
 * request made while a call is in progress only brings the dock back into view; the dock decides whether
 * it may switch target.
 */

export type DockRequest = {
  seq: number;
  /** A lead (or its contact) to preselect. */
  target: DialTarget | null;
  /** Reopen the wrap-up of an earlier call that ended without an outcome. */
  resumeCallId: string | null;
  /** The lead whose drawer can take over for "call from my own phone"; null when no drawer asked. */
  ownPhoneLeadId: string | null;
};

export type DockState = { open: boolean; collapsed: boolean; request: DockRequest | null };

export type OpenOptions = { target?: DialTarget | null; resumeCallId?: string | null; ownPhoneLeadId?: string | null };

/** Fired on `window` when a docked call's outcome has been saved, for a drawer showing that lead. */
export const CALL_LOGGED_EVENT = 'crm:dialer-call-logged';
export type CallLoggedDetail = {
  leadId: string | null;
  activity: { action: string; outcome: string; label: string; notes: string };
  meetingBooked: boolean;
  resumed: boolean;
};
/** Fired when the rep asks to use their own phone instead; the drawer for that lead opens its panel. */
export const OWN_PHONE_EVENT = 'crm:dialer-own-phone';

export type DockStore = {
  getState(): DockState;
  open(options?: OpenOptions): void;
  close(): void;
  setCollapsed(collapsed: boolean): void;
  /** Alt+Shift+D: open when closed, otherwise fold or unfold. */
  toggle(): void;
  subscribe(listener: () => void): () => void;
};

export function createDialerDock(): DockStore {
  let state: DockState = { open: false, collapsed: false, request: null };
  let seq = 0;
  const listeners = new Set<() => void>();
  const set = (next: DockState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,
    open(options = {}) {
      seq += 1;
      set({
        open: true,
        collapsed: false,
        request: { seq, target: options.target ?? null, resumeCallId: options.resumeCallId ?? null, ownPhoneLeadId: options.ownPhoneLeadId ?? null },
      });
    },
    close() {
      if (state.open) set({ open: false, collapsed: false, request: null });
    },
    setCollapsed(collapsed) {
      if (state.open && state.collapsed !== collapsed) set({ ...state, collapsed });
    },
    toggle() {
      if (!state.open) {
        seq += 1;
        set({ open: true, collapsed: false, request: { seq, target: null, resumeCallId: null, ownPhoneLeadId: null } });
        return;
      }
      set({ ...state, collapsed: !state.collapsed });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one dock. */
export const dialerDock = createDialerDock();

/** Pages that draw no staff chrome (the login and the public client-report link) get no dialer. */
export function isDialerHiddenPath(pathname: string | null): boolean {
  return pathname === '/login' || (pathname?.startsWith('/client-reports/public') ?? false);
}

/** True for Alt+Shift+D with no other modifier (plain Alt+D belongs to the browser's address bar). */
export function isDialerShortcut(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>): boolean {
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (event.code === 'KeyD' || event.key.toLowerCase() === 'd');
}

/** Whether a keystroke's target is somewhere the rep is typing; shortcuts stay out of it. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
