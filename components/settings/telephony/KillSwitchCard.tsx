'use client';

import { useState } from 'react';
import { OctagonX, PlayCircle } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import type { SettingsDto } from '@/lib/telephony/settingsAdmin';
import type { SendResult } from './useTelephonySettings';

type Props = { settings: SettingsDto; send: (url: string, method: 'PATCH', body: unknown) => Promise<SendResult> };

/** One big control: stop every call for this team now, or lift the stop. Reps keep the manual call panel. */
export default function KillSwitchCard({ settings, send }: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const change = async (killed: boolean) => {
    if (!killed && !window.confirm('Allow the team to place calls again?')) return;
    setBusy(true);
    const result = await send('/api/telephony/settings', 'PATCH', { killed });
    setBusy(false);
    showToast(result.ok ? (killed ? 'Calling stopped for the whole team' : 'Calling allowed again') : result.error, result.ok ? 'success' : 'error');
  };

  return (
    <section
      aria-labelledby="kill-switch-heading"
      className={`rounded-2xl border p-5 shadow-sm ${settings.killed ? 'border-brand-red bg-brand-red/10' : 'border-card-border bg-card-bg'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="kill-switch-heading" className="type-section text-text-primary">
            {settings.killed ? 'Calling is stopped' : 'Emergency stop'}
          </h2>
          <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text-secondary" role="status" aria-live="polite">
            {settings.killed
              ? `Stopped${settings.killedByName ? ` by ${settings.killedByName}` : ''}${settings.killedAt ? ` on ${new Date(settings.killedAt).toLocaleString()}` : ''}. No new call connects and no softphone login is issued. Reps can still log calls made from their own phone.`
              : 'Stops every call for the whole team immediately: calls already parked are hung up and nobody can log in to the softphone. Manual call logging keeps working.'}
          </p>
        </div>
        {settings.killed ? (
          <button
            type="button"
            onClick={() => void change(false)}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl border border-card-border bg-card-bg px-5 py-3 text-sm font-bold text-text-primary shadow-sm hover:bg-card-border/30 disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5" aria-hidden="true" />
            Allow calling again
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void change(true)}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl bg-brand-red px-6 py-3 text-sm font-extrabold text-white shadow-md hover:bg-brand-red-hover disabled:opacity-60"
          >
            <OctagonX className="h-5 w-5" aria-hidden="true" />
            Stop all calls now
          </button>
        )}
      </div>
    </section>
  );
}
