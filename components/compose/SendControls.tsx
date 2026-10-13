'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, FlaskConical, ShieldAlert } from 'lucide-react';
import { buildSchedulePicks, SCHEDULE_MIN_LEAD_MS } from '@/lib/email/sendControls';
import type { ChecklistItem } from '@/lib/email/preflight';

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input, in the browser's zone. */
const toInputValue = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const formatAt = (date: Date) =>
  date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface ScheduleMenuProps {
  /** The chosen send time, or null for "send now". */
  value: Date | null;
  onChange: (value: Date | null) => void;
  leadTimezone?: string | null;
  disabled?: boolean;
}

/** Quick picks (tomorrow 8am, Monday 9am, in the lead's and the rep's time) and a custom date and time. */
export function ScheduleMenu({ value, onChange, leadTimezone, disabled }: ScheduleMenuProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const myTimezone = browserTimezone();
  const picks = useMemo(
    () => (open ? buildSchedulePicks({ now: new Date(), leadTimezone, myTimezone }) : []),
    [open, leadTimezone, myTimezone],
  );

  const choose = (at: Date | null) => { setError(null); onChange(at); setOpen(false); };
  const applyCustom = () => {
    const at = new Date(custom);
    if (Number.isNaN(at.getTime())) { setError('Pick a date and time'); return; }
    if (at.getTime() - Date.now() < SCHEDULE_MIN_LEAD_MS) { setError('Pick a time at least a minute from now'); return; }
    choose(at);
  };

  return (
    <div className="relative">
      <button
        type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold focus-ring disabled:opacity-50 ${value ? 'border-brand-red/30 bg-brand-red/10 text-brand-red' : 'border-card-border text-text-secondary hover:text-text-primary'}`}
      >
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {value ? `Scheduled: ${formatAt(value)}` : 'Schedule send'}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label="Schedule send" className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-card-border bg-card-bg p-2 shadow-xl">
          <ul className="space-y-0.5">
            {picks.map((pick) => (
              <li key={pick.id}>
                <button type="button" onClick={() => choose(pick.at)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-card-border/30 focus-ring">
                  <span className="font-semibold text-text-primary">{pick.label}</span>
                  <span className="text-text-muted">{formatAt(pick.at)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-card-border pt-2">
            <label htmlFor="schedule-custom" className="text-xs font-semibold text-text-muted">Pick date and time</label>
            <div className="mt-1 flex gap-2">
              <input
                id="schedule-custom" type="datetime-local" value={custom} min={toInputValue(new Date())}
                onChange={(e) => setCustom(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-card-border bg-bg-main px-2 py-1 text-xs text-text-primary"
              />
              <button type="button" onClick={applyCustom} className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 focus-ring">Set</button>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">Your time zone: {myTimezone}{leadTimezone ? ` - the lead's: ${leadTimezone}` : ''}</p>
            {error && <p role="alert" className="mt-1 text-xs font-semibold text-brand-red">{error}</p>}
          </div>
          {value && (
            <button type="button" onClick={() => choose(null)} className="mt-2 w-full rounded-lg border border-card-border px-2 py-1.5 text-xs font-semibold text-text-secondary hover:bg-card-border/30 focus-ring">
              Send now instead
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface TrackingToggleProps {
  opens: boolean;
  clicks: boolean;
  onChange: (next: { opens: boolean; clicks: boolean }) => void;
  disabled?: boolean;
}

/** Per-email tracking, preset from the tenant default. */
export function TrackingToggles({ opens, clicks, onChange, disabled }: TrackingToggleProps) {
  return (
    <fieldset className="flex items-center gap-3 text-xs text-text-secondary" disabled={disabled}>
      <legend className="sr-only">Tracking for this email</legend>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={opens} onChange={(e) => onChange({ opens: e.target.checked, clicks })} />
        Track opens
      </label>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={clicks} onChange={(e) => onChange({ opens, clicks: e.target.checked })} />
        Track clicks
      </label>
    </fieldset>
  );
}

interface TestSendButtonProps {
  disabled?: boolean;
  onSend: () => Promise<{ ok: boolean; message: string }>;
}

/** "Send test to me": the rendered email, with this lead's variables, to the rep's own address. */
export function TestSendButton({ disabled, onSend }: TestSendButtonProps) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" disabled={disabled || busy}
      onClick={async () => { setBusy(true); try { await onSend(); } finally { setBusy(false); } }}
      className="inline-flex items-center gap-1 rounded-lg border border-card-border px-2 py-1 text-xs font-semibold text-text-secondary hover:text-text-primary focus-ring disabled:opacity-50"
    >
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
      {busy ? 'Sending test...' : 'Send test to me'}
    </button>
  );
}

export interface ChecklistState {
  items: ChecklistItem[];
  canSend: boolean;
  loading: boolean;
}

/**
 * Runs the pre-send checklist (POST /api/email/preflight) a moment after the draft changes, so the
 * result is on screen before Send is pressed. A failed check never blocks sending by itself: only a
 * blocking item the server reported does.
 */
export function usePreflight(input: { enabled: boolean; leadId: string; accountId: string; subject: string; body: string; bulk: boolean }): ChecklistState {
  const [state, setState] = useState<ChecklistState>({ items: [], canSend: true, loading: false });
  const { enabled, leadId, accountId, subject, body, bulk } = input;
  useEffect(() => {
    if (!enabled || !accountId) return;
    let live = true;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const res = await fetch('/api/email/preflight', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leadId, accountId, subject, body, bulk }),
        });
        const data = res.ok ? ((await res.json()) as { items: ChecklistItem[]; canSend: boolean }) : null;
        if (live) setState(data ? { ...data, loading: false } : { items: [], canSend: true, loading: false });
      } catch {
        if (live) setState({ items: [], canSend: true, loading: false });
      }
    }, 900);
    return () => { live = false; clearTimeout(timer); };
  }, [enabled, leadId, accountId, subject, body, bulk]);
  return state;
}

/** The checklist, quiet when everything is fine; blocking items first. */
export function ChecklistPanel({ state }: { state: ChecklistState }) {
  const [showAll, setShowAll] = useState(false);
  if (state.items.length === 0) return null;
  const problems = state.items.filter((i) => i.severity !== 'ok').sort((x, y) => (x.severity === 'block' ? -1 : 0) - (y.severity === 'block' ? -1 : 0));
  const shown = showAll ? state.items : problems;
  return (
    <section aria-label="Pre-send checklist" className="rounded-lg border border-card-border bg-bg-main/40 p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-text-primary">
          {problems.length === 0 ? 'All checks passed' : state.canSend ? 'Before you send' : 'Cannot send yet'}
        </h3>
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-text-muted hover:text-text-primary focus-ring rounded">
          {showAll ? 'Show issues only' : 'Show all checks'}
        </button>
      </div>
      {shown.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {shown.map((item) => (
            <li key={item.id} className="flex items-start gap-1.5">
              {item.severity === 'block' ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-red" aria-hidden="true" />
                : item.severity === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden="true" />}
              <span>
                <span className={`font-semibold ${item.severity === 'block' ? 'text-brand-red' : 'text-text-primary'}`}>
                  {item.severity === 'block' ? 'Blocking: ' : item.severity === 'warn' ? 'Warning: ' : ''}{item.label}.
                </span>{' '}
                <span className="text-text-muted">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
