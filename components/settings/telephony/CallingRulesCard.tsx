'use client';

import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import type { SettingsDto } from '@/lib/telephony/settingsAdmin';
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from '@/lib/telephony/settingsInput';
import type { SendResult } from './useTelephonySettings';

/**
 * The editable calling rules. The page keys this card by the server's `updatedAt`, so after a save the
 * reloaded settings start a fresh draft.
 */
type Props = { settings: SettingsDto; send: (url: string, method: 'PATCH', body: unknown) => Promise<SendResult> };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STEP_MINUTES = 30;
const MINUTES_PER_DAY = 1440;
const VIETNAM = 'VN';

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Every two-letter region the browser can name, minus Vietnam (called from the rep's own phone). */
function useCountryOptions() {
  return useMemo(() => {
    const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    return letters
      .flatMap((a) => letters.map((b) => `${a}${b}`))
      .map((code) => ({ code, name: names.of(code) }))
      .filter((c): c is { code: string; name: string } => Boolean(c.name) && c.code !== VIETNAM)
      .sort((x, y) => x.name.localeCompare(y.name));
  }, []);
}

function minuteOptions(current: number, from: number) {
  const options = new Set<number>([current]);
  for (let m = from; m <= MINUTES_PER_DAY; m += STEP_MINUTES) options.add(m);
  return [...options].sort((a, b) => a - b);
}

const fieldClass = 'rounded-lg border border-card-border bg-bg-main px-2.5 py-1.5 text-xs font-medium text-text-primary focus:border-brand-red focus:outline-none';

function Switch({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="mt-0.5 h-4 w-4 accent-brand-red"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div>
        <label htmlFor={id} className="cursor-pointer text-xs font-semibold text-text-primary">{label}</label>
        {hint && <p id={`${id}-hint`} className="max-w-[62ch] text-[11px] leading-4 text-text-muted">{hint}</p>}
      </div>
    </div>
  );
}

export default function CallingRulesCard({ settings, send }: Props) {
  const { showToast } = useToast();
  const countries = useCountryOptions();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [vietnamNote, setVietnamNote] = useState(false);
  const patch = (changes: Partial<SettingsDto>) => setDraft((d) => ({ ...d, ...changes }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.anyTime && draft.callingHoursStart >= draft.callingHoursEnd) {
      showToast('Calling hours must start before they end', 'error');
      return;
    }
    if (!draft.anyTime && draft.allowedWeekdays.length === 0) {
      showToast('Pick at least one weekday, or choose any time', 'error');
      return;
    }
    setSaving(true);
    const result = await send('/api/telephony/settings', 'PATCH', {
      enabled: draft.enabled,
      dryRun: draft.dryRun,
      ...(draft.anyTime
        ? { anyTime: true }
        : { anyTime: false, callingHoursStart: draft.callingHoursStart, callingHoursEnd: draft.callingHoursEnd, allowedWeekdays: draft.allowedWeekdays }),
      allowedCountries: draft.allowedCountries,
      recordingEnabled: draft.recordingEnabled,
      recordingNotice: draft.recordingNotice,
      recordingRetentionDays: draft.recordingRetentionDays,
    });
    setSaving(false);
    showToast(result.ok ? 'Dialer settings saved' : result.error, result.ok ? 'success' : 'error');
  };

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-card-border bg-card-bg p-5 shadow-sm" aria-labelledby="rules-heading">
      <h2 id="rules-heading" className="type-section text-text-primary">Calling rules</h2>

      <div className="space-y-3">
        <Switch id="tel-enabled" label="Dialer on for this team" hint="Nobody can call until this is on and the server switches allow it." checked={draft.enabled} onChange={(enabled) => patch({ enabled })} />
        <Switch id="tel-dryrun" label="Dry run" hint="Every call is checked against the rules and recorded as blocked; no call is placed. Turn off for the live check." checked={draft.dryRun} onChange={(dryRun) => patch({ dryRun })} />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-[10px] font-bold uppercase text-text-muted">Calling hours</legend>
        <Switch id="tel-anytime" label="Any time" hint="Every hour of every day. No timezone is needed." checked={draft.anyTime} onChange={(anyTime) => patch({ anyTime })} />
        {!draft.anyTime && (
          <div className="space-y-3 pl-7">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label htmlFor="tel-from" className="font-semibold text-text-primary">From</label>
              <select id="tel-from" className={fieldClass} value={draft.callingHoursStart} onChange={(e) => patch({ callingHoursStart: Number(e.target.value) })}>
                {minuteOptions(draft.callingHoursStart, 0).filter((m) => m < MINUTES_PER_DAY).map((m) => <option key={m} value={m}>{clock(m)}</option>)}
              </select>
              <label htmlFor="tel-to" className="font-semibold text-text-primary">to</label>
              <select id="tel-to" className={fieldClass} value={draft.callingHoursEnd} onChange={(e) => patch({ callingHoursEnd: Number(e.target.value) })}>
                {minuteOptions(draft.callingHoursEnd, STEP_MINUTES).map((m) => <option key={m} value={m}>{m === MINUTES_PER_DAY ? '24:00' : clock(m)}</option>)}
              </select>
              <span className="text-text-muted">in the lead&apos;s local time</span>
            </div>
            <fieldset>
              <legend className="mb-1 text-xs font-semibold text-text-primary">Days</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {WEEKDAYS.map((name, day) => (
                  <label key={name} className="flex items-center gap-1.5 text-xs text-text-primary">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-brand-red"
                      checked={draft.allowedWeekdays.includes(day)}
                      onChange={(e) =>
                        patch({ allowedWeekdays: e.target.checked ? [...draft.allowedWeekdays, day].sort((a, b) => a - b) : draft.allowedWeekdays.filter((d) => d !== day) })
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[10px] font-bold uppercase text-text-muted">Countries the team may dial through the dialer</legend>
        <p className="max-w-[62ch] text-[11px] leading-4 text-text-muted">
          Nothing is dialable until a country is added. Vietnam is not offered: Vietnamese numbers are called from the rep&apos;s own phone and logged in the CRM.
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Allowed countries">
          {draft.allowedCountries.length === 0 && <li className="text-xs text-text-muted">No countries yet</li>}
          {draft.allowedCountries.map((code) => (
            <li key={code} className="flex items-center gap-1 rounded-full border border-card-border bg-bg-main py-0.5 pl-2.5 pr-1 text-xs font-semibold text-text-primary">
              {nameOf(code)} ({code})
              <button
                type="button"
                aria-label={`Remove ${nameOf(code)}`}
                className="rounded-full p-0.5 hover:bg-card-border/40"
                onClick={() => patch({ allowedCountries: draft.allowedCountries.filter((c) => c !== code) })}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="tel-add-country" className="text-xs font-semibold text-text-primary">Add a country</label>
          <select
            id="tel-add-country"
            className={fieldClass}
            value=""
            onChange={(e) => {
              const code = e.target.value;
              if (code) patch({ allowedCountries: [...new Set([...draft.allowedCountries, code])] });
            }}
          >
            <option value="">Choose…</option>
            {countries.filter((c) => !draft.allowedCountries.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
          <button type="button" className="text-[11px] text-text-muted underline" onClick={() => setVietnamNote((v) => !v)} aria-expanded={vietnamNote}>
            Why not Vietnam?
          </button>
        </div>
        {vietnamNote && (
          <p className="max-w-[62ch] rounded-lg bg-bg-main p-2 text-[11px] leading-4 text-text-secondary" role="note">
            Telnyx does not carry calls to Vietnam, so the lead drawer opens a panel with the number to call from the rep&apos;s own phone, then the rep logs the outcome here.
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-[10px] font-bold uppercase text-text-muted">Recording</legend>
        <Switch id="tel-rec" label="Record calls" checked={draft.recordingEnabled} onChange={(recordingEnabled) => patch({ recordingEnabled })} />
        <Switch
          id="tel-notice"
          label="Say a recording notice at the start of each call"
          hint="Off by default. Switch it on where the law of the lead's country requires it."
          checked={draft.recordingNotice}
          onChange={(recordingNotice) => patch({ recordingNotice })}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="tel-retention" className="font-semibold text-text-primary">Keep recordings for</label>
          <input
            id="tel-retention"
            type="number"
            inputMode="numeric"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            step={1}
            className={`${fieldClass} w-24`}
            value={draft.recordingRetentionDays}
            onChange={(e) => patch({ recordingRetentionDays: Math.trunc(Number(e.target.value)) })}
          />
          <span className="text-text-muted">days ({MIN_RETENTION_DAYS} to {MAX_RETENTION_DAYS})</span>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 rounded-lg bg-brand-red px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-red-hover disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Save calling rules
        </button>
        {dirty && <span className="text-[11px] text-text-muted" role="status">Unsaved changes</span>}
      </div>
    </form>
  );
}
