/**
 * The composer's send controls, as pure rules shared by the routes, the worker and the composer UI:
 * when a message may leave (now, after the undo window, or at a scheduled time), which tracking it
 * goes out with, and the quick picks the schedule menu offers. No database, no clock but the one
 * passed in, so every branch is testable.
 */
import { getLocalTime, isValidTimezone, localToUtc } from '@/lib/automation/timezone';

/** The undo window the composer applies to an immediate send. */
export const UNDO_DELAY_SECONDS = 10;
/** The longest delay a client may ask for on an "immediate" send. */
export const UNDO_DELAY_MAX_SECONDS = 30;
/** A scheduled send must be at least this far ahead, otherwise it is just a send. */
export const SCHEDULE_MIN_LEAD_MS = 60_000;
/** ...and no further than this: a schedule is a day-to-day tool, not a reminder system. */
export const SCHEDULE_MAX_DAYS = 90;
/** A job that fires this much before its scheduled time is early; clock skew below it is not. */
export const SCHEDULE_FIRE_TOLERANCE_MS = 1_000;

export type SendTiming =
  | { kind: 'now'; delayMs: 0; scheduledFor: null }
  | { kind: 'undo'; delayMs: number; scheduledFor: null }
  | { kind: 'scheduled'; delayMs: number; scheduledFor: Date };

export function resolveSendTiming(input: {
  scheduledFor?: string | Date | null;
  delaySeconds?: number | null;
  now?: Date;
}): { ok: true; timing: SendTiming } | { ok: false; error: string } {
  const now = input.now ?? new Date();
  if (input.scheduledFor) {
    const at = input.scheduledFor instanceof Date ? input.scheduledFor : new Date(input.scheduledFor);
    if (Number.isNaN(at.getTime())) return { ok: false, error: 'That send time is not a valid date' };
    const ahead = at.getTime() - now.getTime();
    if (ahead < SCHEDULE_MIN_LEAD_MS) return { ok: false, error: 'Pick a send time at least a minute from now' };
    if (ahead > SCHEDULE_MAX_DAYS * 86_400_000) return { ok: false, error: `Emails can be scheduled up to ${SCHEDULE_MAX_DAYS} days ahead` };
    return { ok: true, timing: { kind: 'scheduled', delayMs: ahead, scheduledFor: at } };
  }
  const seconds = Math.min(Math.max(Math.floor(input.delaySeconds ?? 0), 0), UNDO_DELAY_MAX_SECONDS);
  if (seconds > 0) return { ok: true, timing: { kind: 'undo', delayMs: seconds * 1000, scheduledFor: null } };
  return { ok: true, timing: { kind: 'now', delayMs: 0, scheduledFor: null } };
}

/**
 * A cadence step is sent now: it cannot be taken back from the composer (cancel / undo are for
 * one-off emails), so offering a delay or a schedule would be a fake undo.
 */
export function forceImmediateForSequenceStep(timing: SendTiming, isSequenceStep: boolean): SendTiming {
  return isSequenceStep ? { kind: 'now', delayMs: 0, scheduledFor: null } : timing;
}

/** How long a job that woke up too early must wait (ms), or 0 when it is due. */
export function msUntilDue(scheduledFor: Date | null | undefined, now: Date = new Date()): number {
  if (!scheduledFor) return 0;
  const wait = scheduledFor.getTime() - now.getTime();
  return wait > SCHEDULE_FIRE_TOLERANCE_MS ? wait : 0;
}

/**
 * Open / click tracking for one send. A row the composer decided (either flag set) wins; otherwise
 * the cadence decides, as it always has. A one-off with nothing decided is untracked.
 */
export function resolveTracking(
  row: { trackOpens: boolean | null; trackClicks: boolean | null },
  sequence: { trackOpens: boolean; trackClicks: boolean } | null,
): { opens: boolean; clicks: boolean } {
  if (row.trackOpens != null || row.trackClicks != null) {
    return { opens: row.trackOpens === true, clicks: row.trackClicks === true };
  }
  return { opens: sequence?.trackOpens === true, clicks: sequence?.trackClicks === true };
}

export interface SchedulePick {
  id: string;
  label: string;
  at: Date;
  /** The zone the label's clock time is in. */
  timezone: string;
}

/** The next calendar day (year, month, day) after the local date of `from` in `timezone`. */
function localDayAfter(from: Date, timezone: string, days: number): { year: number; month: number; day: number; dayOfWeek: number } {
  const today = getLocalTime(from, timezone);
  // Noon avoids the DST edge when stepping whole days.
  const probe = localToUtc(today.year, today.month, today.day + days, 12, 0, timezone);
  const next = getLocalTime(probe, timezone);
  return { year: next.year, month: next.month, day: next.day, dayOfWeek: next.dayOfWeek };
}

/**
 * The schedule menu's quick picks: tomorrow 8:00 and next Monday 9:00 in the lead's time (when the
 * lead has a zone) and in the rep's, plus "in 1 hour". Picks that would not be far enough ahead are
 * left out. Pure: `now` is passed in.
 */
export function buildSchedulePicks(input: { now: Date; leadTimezone?: string | null; myTimezone: string }): SchedulePick[] {
  const { now } = input;
  const picks: SchedulePick[] = [];
  const zones: Array<{ key: 'lead' | 'me'; tz: string; who: string }> = [];
  if (input.leadTimezone && isValidTimezone(input.leadTimezone)) zones.push({ key: 'lead', tz: input.leadTimezone, who: "lead's time" });
  if (!zones.some((z) => z.tz === input.myTimezone)) zones.push({ key: 'me', tz: input.myTimezone, who: 'my time' });
  for (const zone of zones) {
    const tomorrow = localDayAfter(now, zone.tz, 1);
    picks.push({
      id: `tomorrow-${zone.key}`,
      label: `Tomorrow 8:00 am (${zone.who})`,
      at: localToUtc(tomorrow.year, tomorrow.month, tomorrow.day, 8, 0, zone.tz),
      timezone: zone.tz,
    });
    const daysToMonday = ((8 - getLocalTime(now, zone.tz).dayOfWeek) % 7) || 7;
    const monday = localDayAfter(now, zone.tz, daysToMonday);
    picks.push({
      id: `monday-${zone.key}`,
      label: `Monday 9:00 am (${zone.who})`,
      at: localToUtc(monday.year, monday.month, monday.day, 9, 0, zone.tz),
      timezone: zone.tz,
    });
  }
  picks.push({ id: 'in-1h', label: 'In 1 hour', at: new Date(now.getTime() + 3_600_000), timezone: input.myTimezone });
  return picks.filter((p) => p.at.getTime() - now.getTime() >= SCHEDULE_MIN_LEAD_MS);
}
