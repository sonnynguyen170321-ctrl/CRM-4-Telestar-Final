/**
 * A sequence step's timing, in the words the builder shows.
 *
 * The card used to read "Delay: 2d 0h", which says neither what the wait is measured from nor
 * that the days are business days — the two things that decide when a prospect is actually
 * written to. These sentences describe what `lib/automation/scheduling.ts` and
 * `lib/sequences/engine.ts` do; they compute nothing. Browser-safe.
 */

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** "Due 2 business days after step 1 is sent." */
export function describeStepWait(input: {
  delayDays: number;
  delayHours: number;
  /** Order of the step before this one, or null for the first step. */
  previousOrder: number | null;
  /** The previous step is an email the CRM sends itself, rather than a task a rep completes. */
  previousIsAutomatic: boolean;
  sendOnWeekends: boolean;
}): string {
  const anchor =
    input.previousOrder === null
      ? 'the lead is enrolled'
      : `step ${input.previousOrder} is ${input.previousIsAutomatic ? 'sent' : 'completed'}`;

  const parts: string[] = [];
  // Days are business days only while the sequence skips weekends (lib/sequences/rules.ts).
  if (input.delayDays > 0) parts.push(plural(input.delayDays, input.sendOnWeekends ? 'day' : 'business day'));
  if (input.delayHours > 0) parts.push(plural(input.delayHours, 'hour'));

  return parts.length === 0 ? `Due as soon as ${anchor}.` : `Due ${parts.join(' and ')} after ${anchor}.`;
}

/** What the sequence does with a Saturday or Sunday. */
export function describeWeekendRule(sendOnWeekends: boolean): string {
  return sendOnWeekends
    ? 'This sequence also sends on weekends.'
    : 'Weekends are skipped: a date that lands on one moves to Monday morning.';
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** What the two time inputs mean, including the case where both are empty. */
export function describeSendWindow(start: number | null | undefined, end: number | null | undefined): string {
  if (start == null && end == null) return 'No time limit: it goes at whatever time of day it falls due.';
  if (start == null || end == null) return 'Set both times, or clear them.';
  if (end <= start) return 'The end time must be after the start time.';
  return `Only between ${clock(start)} and ${clock(end)} in the lead’s timezone (the lead owner’s when the lead has none, else UTC). Outside it, the email waits for the next window.`;
}
