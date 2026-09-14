'use client';

import { useEffect, useState } from 'react';
import { describeZone, zoneCityName } from '@/lib/time/describeZone';

/**
 * The current time somewhere else, kept current.
 *
 * `14:32 · Tue · GMT+8` with a dot that is green inside 09:00–18:00 Mon–Fri local and grey
 * outside. Ticks at the top of each minute. This is the answer to "can I call them right now?",
 * rendered where that question is asked.
 */
export default function LocalClock({
  timezone,
  compact = false,
  className = '',
}: {
  timezone: string;
  /** Time only, for tight rows. */
  compact?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Align to the next minute boundary, then every 60 s, so the display never shows :31 when
    // the wall clock says :32.
    let interval: ReturnType<typeof setInterval> | undefined;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const first = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, []);

  let desc;
  try {
    desc = describeZone(timezone, now);
  } catch {
    return (
      <span className={`text-xs text-text-muted ${className}`} title={`Unknown timezone: ${timezone}`}>
        —
      </span>
    );
  }

  const label = `${zoneCityName(timezone)} · ${desc.offsetLabel} · ${
    desc.isBusinessHours ? 'business hours' : 'outside business hours'
  }`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs text-text-secondary ${className}`}
      title={label}
      aria-label={`Local time ${desc.localTime} ${desc.weekday}, ${label}`}
    >
      <span
        aria-hidden="true"
        className={`w-1.5 h-1.5 rounded-full ${desc.isBusinessHours ? 'bg-emerald-500' : 'bg-text-muted/50'}`}
      />
      <span className="text-text-primary font-semibold tabular-nums">{desc.localTime}</span>
      {!compact && (
        <>
          <span className="text-text-muted">·</span>
          <span>{desc.weekday}</span>
          <span className="text-text-muted">·</span>
          <span>{desc.offsetLabel}</span>
        </>
      )}
    </span>
  );
}
