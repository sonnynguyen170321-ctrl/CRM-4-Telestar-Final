'use client';

import { convertTime } from '@/lib/time/convertTime';
import { zoneCityName } from '@/lib/time/describeZone';

/**
 * "09:00 Singapore (GMT+8) · 08:00 your time (GMT+7)" under the booking form.
 *
 * This is the moment a wrong-zone meeting gets caught: the rep sees the prospect's time and
 * their own side by side before the invitation goes out. A weekend or an out-of-hours slot in
 * the prospect's zone gets one plain line, not a blocker — sometimes that is the slot they asked
 * for.
 */
export default function MeetingTimePreview({
  scheduledAt,
  zone,
  userZone,
}: {
  /** The `datetime-local` value, `YYYY-MM-DDTHH:MM`. */
  scheduledAt: string;
  /** The zone the value is in. */
  zone: string;
  userZone: string;
}) {
  const [date, time] = scheduledAt.split('T');
  if (!date || !time) return null;
  const [hour, minute] = time.split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  let rows;
  try {
    rows = convertTime({ date, hour, minute, fromZone: zone, toZones: [zone, userZone] });
  } catch {
    return null;
  }
  const [prospect, mine] = rows;
  const sameZone = zone === userZone;

  return (
    <div className="rounded-lg border border-card-border/60 bg-bg-main/40 px-3 py-2 text-xs space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono font-semibold text-text-primary tabular-nums">{prospect.localTime}</span>
        <span className="text-text-secondary">
          {zoneCityName(prospect.timezone)} ({prospect.offsetLabel}) · {prospect.weekday}
        </span>
        {!sameZone && (
          <>
            <span className="text-text-muted">·</span>
            <span className="font-mono font-semibold text-text-primary tabular-nums">{mine.localTime}</span>
            <span className="text-text-secondary">
              your time ({mine.offsetLabel}){mine.dayShift !== 0 && `, ${mine.dayShift > 0 ? 'next' : 'previous'} day`}
            </span>
          </>
        )}
      </div>
      {!prospect.isBusinessHours && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Outside 09:00–18:00 Mon–Fri in {zoneCityName(prospect.timezone)}.
        </p>
      )}
    </div>
  );
}
