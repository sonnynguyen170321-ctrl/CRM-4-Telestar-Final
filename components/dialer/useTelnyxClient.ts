'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createRtcController,
  type ClientFactory,
  type RtcClientLike,
  type RtcController,
  type RtcSnapshot,
  type TokenFetcher,
} from '@/lib/telephony/rtcController';
import { createTabLock, TAB_LOCK_CHANNEL, type ChannelLike } from '@/lib/telephony/tabLock';

/**
 * The browser's one Telnyx client, as a hook (docs/dialer/TASKS.md D5.1). The logic lives in
 * lib/telephony/rtcController.ts; this only wires it to the page: it starts when the dialer opens,
 * stops (disconnect, release the tab lock) when it closes or the page unmounts, and exposes the
 * registration status.
 *
 * The SDK is imported dynamically inside `loadClientFactory`, so a page that never opens the
 * softphone does not ship it, and nothing touches `window` during server rendering.
 */

const loadClientFactory = async (): Promise<ClientFactory> => {
  const sdk = await import('@telnyx/webrtc');
  const TelnyxRTC = sdk.TelnyxRTC ?? sdk.default;
  return (options) => new TelnyxRTC(options) as unknown as RtcClientLike;
};

const fetchToken: TokenFetcher = async () => {
  try {
    const response = await fetch('/api/telephony/token', { method: 'POST' });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body.token !== 'string' || typeof body.expiresAt !== 'string') {
      return { ok: false, message: (body && typeof body.error === 'string' && body.error) || 'Could not get a phone login', code: body?.code };
    }
    return { ok: true, token: { token: body.token, expiresAt: body.expiresAt } };
  } catch {
    return { ok: false, message: 'Could not reach the server to log the phone in' };
  }
};

const channelFactory = (): ChannelLike | null =>
  typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(TAB_LOCK_CHANNEL) as unknown as ChannelLike);

export type UseTelnyxClient = RtcSnapshot & {
  getClient: () => RtcClientLike | null;
  setCallActive: (active: boolean) => void;
  retry: () => void;
};

export function useTelnyxClient(enabled: boolean): UseTelnyxClient {
  const [snapshot, setSnapshot] = useState<RtcSnapshot>({ status: 'idle', error: null });
  const controllerRef = useRef<RtcController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const lock = createTabLock({ channelFactory, id: crypto.randomUUID() });
    const controller = createRtcController({ loadClientFactory, fetchToken, lock });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSnapshot);
    // The tab that held the lock closed: take over instead of leaving this one stuck.
    const offReleased = lock.onReleased(() => {
      if (controller.getSnapshot().status === 'locked') void controller.start();
    });
    void controller.start();
    return () => {
      offReleased();
      unsubscribe();
      controller.stop();
      controllerRef.current = null;
    };
  }, [enabled]);

  const getClient = useCallback(() => controllerRef.current?.getClient() ?? null, []);
  const setCallActive = useCallback((active: boolean) => controllerRef.current?.setCallActive(active), []);
  const retry = useCallback(() => void controllerRef.current?.start(), []);

  return { ...snapshot, getClient, setCallActive, retry };
}
