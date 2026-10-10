'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import type { NumberDto } from '@/lib/telephony/settingsNumbers';
import type { SendResult } from './useTelephonySettings';

type Props = {
  numbers: NumberDto[];
  send: (url: string, method: 'PATCH' | 'POST' | 'DELETE', body?: unknown) => Promise<SendResult>;
};

const E164_PATTERN = '^\\+[1-9][0-9]{6,14}$';
const smallButton = 'rounded-md border border-card-border px-2 py-1 text-[11px] font-semibold text-text-primary hover:bg-card-border/30 disabled:opacity-60';

/** Caller-ID numbers the account owns. The one marked for the dialled country is shown to the lead. */
export default function NumbersCard({ numbers, send }: Props) {
  const { showToast } = useToast();
  const [e164, setE164] = useState('');
  const [label, setLabel] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<SendResult>, success: string) => {
    setBusyId(id);
    const result = await action();
    setBusyId(null);
    showToast(result.ok ? success : result.error, result.ok ? 'success' : 'error');
    return result.ok;
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await run('new', () => send('/api/telephony/settings/numbers', 'POST', { e164: e164.trim(), ...(label.trim() ? { label: label.trim() } : {}) }), 'Number added');
    if (ok) {
      setE164('');
      setLabel('');
    }
  };

  const change = (n: NumberDto, body: Record<string, unknown>, success: string) =>
    run(n.id, () => send(`/api/telephony/settings/numbers/${n.id}`, 'PATCH', body), success);

  return (
    <section aria-labelledby="numbers-heading" className="space-y-3 rounded-2xl border border-card-border bg-card-bg p-5 shadow-sm">
      <div>
        <h2 id="numbers-heading" className="type-section text-text-primary">Caller ID numbers</h2>
        <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text-secondary">
          Numbers the Telnyx account owns. A call shows the default for the lead&apos;s country; for a country with none, the overall default; with no numbers at all, the provider&apos;s own number.
        </p>
      </div>

      {numbers.length === 0 ? (
        <p className="text-xs text-text-muted">No numbers yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Caller ID numbers</caption>
            <thead>
              <tr className="text-[10px] font-bold uppercase text-text-muted">
                <th scope="col" className="py-1 pr-3">Number</th>
                <th scope="col" className="py-1 pr-3">Country</th>
                <th scope="col" className="py-1 pr-3">Status</th>
                <th scope="col" className="py-1 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.id} className="border-t border-card-border align-top">
                  <td className="py-2 pr-3 font-mono text-text-primary">
                    {n.e164}
                    {n.label && <span className="ml-2 font-sans text-text-muted">{n.label}</span>}
                  </td>
                  <td className="py-2 pr-3 text-text-primary">{n.country}</td>
                  <td className="py-2 pr-3 text-text-secondary">
                    {n.isActive ? 'On' : 'Off'}
                    {n.isDefault && <span className="ml-2 font-semibold text-text-primary">Default for {n.country}</span>}
                    {n.isOverallDefault && <span className="ml-2 font-semibold text-text-primary">Overall default</span>}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {n.isActive && !n.isDefault && <button type="button" className={smallButton} disabled={busyId === n.id} onClick={() => void change(n, { isDefault: true }, `Default for ${n.country} updated`)}>Make default for {n.country}</button>}
                      {n.isActive && !n.isOverallDefault && <button type="button" className={smallButton} disabled={busyId === n.id} onClick={() => void change(n, { isOverallDefault: true }, 'Overall default updated')}>Make overall default</button>}
                      <button type="button" className={smallButton} disabled={busyId === n.id} onClick={() => void change(n, { isActive: !n.isActive }, n.isActive ? 'Number turned off' : 'Number turned on')}>{n.isActive ? 'Turn off' : 'Turn on'}</button>
                      <button
                        type="button"
                        className={`${smallButton} text-brand-red`}
                        disabled={busyId === n.id}
                        aria-label={`Remove ${n.e164}`}
                        onClick={() => {
                          if (window.confirm(`Remove ${n.e164} from the dialer? It stays on the Telnyx account.`)) {
                            void run(n.id, () => send(`/api/telephony/settings/numbers/${n.id}`, 'DELETE'), 'Number removed');
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t border-card-border pt-3">
        <div className="space-y-1">
          <label htmlFor="tel-new-number" className="block text-[10px] font-bold uppercase text-text-muted">Number (international format)</label>
          <input
            id="tel-new-number"
            type="tel"
            required
            pattern={E164_PATTERN}
            title="International format with no spaces, for example +14155550123"
            placeholder="+14155550123"
            value={e164}
            onChange={(e) => setE164(e.target.value)}
            className="w-52 rounded-lg border border-card-border bg-bg-main px-2.5 py-1.5 font-mono text-xs text-text-primary focus:border-brand-red focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="tel-new-label" className="block text-[10px] font-bold uppercase text-text-muted">Label (optional)</label>
          <input
            id="tel-new-label"
            type="text"
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-44 rounded-lg border border-card-border bg-bg-main px-2.5 py-1.5 text-xs text-text-primary focus:border-brand-red focus:outline-none"
          />
        </div>
        <button type="submit" disabled={busyId === 'new'} className="flex items-center gap-1.5 rounded-lg bg-brand-red px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-red-hover disabled:opacity-60">
          {busyId === 'new' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
          Add number
        </button>
      </form>
    </section>
  );
}
