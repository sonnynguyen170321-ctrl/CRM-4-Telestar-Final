'use client';

import { useCallback, useEffect, useState } from 'react';

import { readApiError } from '@/lib/api/client';
import type { SettingsDto, deploymentState } from '@/lib/telephony/settingsAdmin';
import type { CredentialDto, NumberDto } from '@/lib/telephony/settingsNumbers';

export type TelephonyPayload = {
  settings: SettingsDto;
  deployment: ReturnType<typeof deploymentState>;
  numbers: NumberDto[];
  credentials: CredentialDto[];
};

export type SendResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string };

/** Loads settings/telephony and sends changes; every change reloads so the page shows what the server holds. */
export function useTelephonySettings() {
  const [payload, setPayload] = useState<TelephonyPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/telephony/settings', { cache: 'no-store' });
      if (!res.ok) {
        setLoadError(await readApiError(res, 'Could not load the dialer settings'));
        return;
      }
      setPayload((await res.json()) as TelephonyPayload);
      setLoadError(null);
    } catch {
      setLoadError('Could not load the dialer settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async <T = Record<string, unknown>>(url: string, method: 'PATCH' | 'POST' | 'DELETE', body?: unknown): Promise<SendResult<T>> => {
      try {
        const res = await fetch(url, {
          method,
          ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        });
        if (!res.ok) return { ok: false, error: await readApiError(res, 'The change was not saved') };
        const data = (await res.json()) as T;
        await load();
        return { ok: true, data };
      } catch {
        return { ok: false, error: 'The change was not saved: network error' };
      }
    },
    [load]
  );

  return { payload, loadError, send };
}
