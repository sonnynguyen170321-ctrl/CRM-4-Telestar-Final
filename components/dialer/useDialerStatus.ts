'use client';

import { useCallback, useEffect, useState } from 'react';

import { dialerStatusStore, type DialerStatus } from '@/lib/telephony/dialerStatus';

/**
 * Whether the browser dialer is available to this rep (`GET /api/telephony/status`), as
 * `unknown | enabled | disabled` (lib/telephony/dialerStatus.ts). It asks on mount and again whenever the
 * window regains focus, so a server-side flip is seen without a reload. `resolve()` is what the Call
 * button awaits: the answer, or `disabled` after about two seconds.
 */
export function useDialerStatus(): { status: DialerStatus; resolve: () => Promise<DialerStatus> } {
  const [status, setStatus] = useState<DialerStatus>(() => dialerStatusStore.peek());
  useEffect(() => {
    const unsubscribe = dialerStatusStore.subscribe(setStatus);
    void dialerStatusStore.refresh().then(setStatus);
    const onFocus = () => void dialerStatusStore.refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  const resolve = useCallback(() => dialerStatusStore.resolve(), []);
  return { status, resolve };
}
