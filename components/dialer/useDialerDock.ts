'use client';

import { useSyncExternalStore } from 'react';

import { dialerDock, type DockState } from '@/lib/telephony/dialerDock';

const SERVER_STATE: DockState = { open: false, collapsed: false, request: null };

/** The dock's state, for components that show or drive it. */
export function useDialerDock(): DockState {
  return useSyncExternalStore(dialerDock.subscribe, dialerDock.getState, () => SERVER_STATE);
}
