'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the browser dialer is available to this rep (`GET /api/telephony/status`). One request is
 * shared by every drawer and re-used for a minute; until it answers, and on any failure, the answer
 * is "no", so the Call button falls back to the phone-call panel instead of waiting or breaking.
 */

const FRESH_MS = 60_000;
let cached: { at: number; promise: Promise<boolean> } | null = null;

function loadStatus(): Promise<boolean> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.promise;
  const promise = fetch('/api/telephony/status')
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => body?.enabled === true)
    .catch(() => false);
  cached = { at: Date.now(), promise };
  return promise;
}

export function useDialerEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadStatus().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
