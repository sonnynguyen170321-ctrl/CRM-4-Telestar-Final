'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import TimezoneSelect from './TimezoneSelect';
import { convertTime } from '@/lib/time/convertTime';
import { getLocalTime } from '@/lib/automation/timezone';
import { zoneCityName } from '@/lib/time/describeZone';
import { PINNED_TIMEZONES } from '@/lib/time/options';
import { useUserTimezone } from '@/lib/hooks/useUserTimezone';

/**
 * "Convert time": a zone + time picker, and the same instant in the zones this team deals with.
 *
 * Opened from the command palette, which renders it directly — no custom event, no listener to
 * forget. Defaults to now in the rep's own zone, so the first render already answers "what time
 * is it in Singapore". No free-text parsing: the council that reviewed this cut it, and a picker
 * cannot be misread.
 */
function nowInZone(zone: string): { date: string; time: string } {
  const l = getLocalTime(new Date(), zone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${l.year}-${pad(l.month)}-${pad(l.day)}`, time: `${pad(l.hour)}:${pad(l.minute)}` };
}

export default function TimeConverter({ onClose }: { onClose: () => void }) {
  const { timezone: userZone } = useUserTimezone();
  const [fromZone, setFromZone] = useState<string>('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [extraZone, setExtraZone] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const sourceZone = fromZone || userZone;

  // Seed with "now, in my zone" once the user's zone is known.
  useEffect(() => {
    if (!date && !time) {
      const n = nowInZone(sourceZone);
      setDate(n.date);
      setTime(n.time);
    }
  }, [sourceZone, date, time]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const targets = useMemo(() => {
    const set = new Set<string>([userZone, ...PINNED_TIMEZONES]);
    if (extraZone) set.add(extraZone);
    set.delete(sourceZone);
    return [...set];
  }, [userZone, extraZone, sourceZone]);

  const rows = useMemo(() => {
    const [hh, mm] = time.split(':').map(Number);
    if (!date || Number.isNaN(hh) || Number.isNaN(mm)) return [];
    try {
      return convertTime({ date, hour: hh, minute: mm, fromZone: sourceZone, toZones: targets });
    } catch {
      return [];
    }
  }, [date, time, sourceZone, targets]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Convert time"
        className="relative z-10 w-full max-w-lg bg-card-bg border border-card-border rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-card-border/60">
          <h2 className="font-display font-bold text-sm text-text-primary">Convert time</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-card-border/40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="block text-[10px] font-semibold uppercase text-text-muted">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary [color-scheme:dark]"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-semibold uppercase text-text-muted">Time</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full bg-bg-main border border-card-border rounded-lg px-2.5 py-1.5 text-text-primary [color-scheme:dark]"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-semibold uppercase text-text-muted">In</span>
            <TimezoneSelect value={sourceZone} onChange={setFromZone} className="w-full" />
          </label>
        </div>

        <ul className="px-4 pb-2 divide-y divide-card-border/40">
          {rows.map((r) => (
            <li key={r.timezone} className="flex items-center justify-between py-2 text-xs">
              <span className="flex items-center gap-2 text-text-secondary">
                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full ${r.isBusinessHours ? 'bg-emerald-500' : 'bg-text-muted/50'}`}
                />
                {zoneCityName(r.timezone)}
                <span className="text-text-muted">{r.offsetLabel}</span>
              </span>
              <span className="font-mono tabular-nums text-text-primary font-semibold">
                {r.localTime}
                <span className="ml-2 text-text-muted font-normal">
                  {r.weekday}
                  {r.dayShift !== 0 && (r.dayShift > 0 ? ' (+1 day)' : ' (−1 day)')}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="px-4 pb-4 pt-1 flex items-center gap-2 text-xs">
          <span className="text-text-muted">Add a zone:</span>
          <TimezoneSelect value={extraZone} onChange={setExtraZone} allowEmpty className="flex-1" />
        </div>
      </div>
    </div>
  );
}
