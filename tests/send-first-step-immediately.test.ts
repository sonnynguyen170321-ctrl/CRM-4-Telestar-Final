import { describe, expect, it } from 'vitest';

import { computeStepDueDate } from '@/lib/sequences/engine';
import { DEFAULT_SEQUENCE_RULES, sendsImmediatelyOnEnroll } from '@/lib/sequences/rules';
import { describeStepWait } from '@/lib/sequences/stepDescription';

/**
 * "Send step 1 immediately" (owner request, 2026-10-06): a rep who adds leads after the send
 * window wants step 1 to go now, not at the next window. A per-sequence switch, off by default.
 * It applies only to an automatic email step 1 with no wait; caps, suppression and the sender
 * rules are untouched (they are checked elsewhere and never consult it).
 */

const step1 = { order: 1, channel: 'email', autoComplete: true, delayDays: 0, delayHours: 0 };
const on = { sendFirstStepImmediately: true };

describe('sendsImmediatelyOnEnroll', () => {
  it('is off by default, so existing sequences keep their behaviour', () => {
    expect(DEFAULT_SEQUENCE_RULES.sendFirstStepImmediately).toBe(false);
    expect(sendsImmediatelyOnEnroll(DEFAULT_SEQUENCE_RULES, step1)).toBe(false);
    expect(sendsImmediatelyOnEnroll(null, step1)).toBe(false);
  });

  it('applies to an automatic email step 1 with no wait', () => {
    expect(sendsImmediatelyOnEnroll(on, step1)).toBe(true);
    expect(sendsImmediatelyOnEnroll(on, { ...step1, delayHours: null })).toBe(true);
  });

  it.each([
    ['a later step', { ...step1, order: 2 }],
    ['a step with a wait in days', { ...step1, delayDays: 1 }],
    ['a step with a wait in hours', { ...step1, delayHours: 2 }],
    ['a manual email (a task for the rep)', { ...step1, autoComplete: false }],
    ['a call step', { ...step1, channel: 'phone' }],
  ])('does not apply to %s', (_label, step) => {
    expect(sendsImmediatelyOnEnroll(on, step)).toBe(false);
  });
});

describe('computeStepDueDate', () => {
  // Monday 2026-10-05 20:00 in Ho Chi Minh City, after an 08:00–17:00 window.
  const evening = new Date('2026-10-05T13:00:00Z');
  const windowed = { delayDays: 0, delayHours: 0, sendWindowStartMinutes: 480, sendWindowEndMinutes: 1020 };
  const options = { timezone: 'Asia/Ho_Chi_Minh', seed: 'seed', businessDayPolicy: 'skip_weekends' as const };

  it('moves an out-of-window step to the next window when the switch is off', () => {
    const due = computeStepDueDate(evening, windowed, options);
    expect(due.getTime()).toBeGreaterThan(evening.getTime());
    expect(due.toISOString() >= '2026-10-06T01:00:00.000Z').toBe(true); // 08:00 next day, local
  });

  it('is due at once when the step sends immediately', () => {
    expect(computeStepDueDate(evening, windowed, { ...options, immediate: true }).toISOString()).toBe(evening.toISOString());
  });

  it('is due at once on a weekend too', () => {
    const sunday = new Date('2026-10-04T13:00:00Z');
    expect(computeStepDueDate(sunday, windowed, { ...options, immediate: true }).toISOString()).toBe(sunday.toISOString());
  });
});

describe('describeStepWait', () => {
  const base = { delayDays: 0, delayHours: 0, previousOrder: null, previousIsAutomatic: false, sendOnWeekends: false };

  it('says step 1 goes the moment the lead is enrolled, whatever the window', () => {
    expect(describeStepWait({ ...base, sendsImmediately: true })).toBe(
      'Sent as soon as the lead is enrolled, even outside the send window or on a weekend.'
    );
  });

  it('keeps the old sentence when the switch is off', () => {
    expect(describeStepWait(base)).toBe('Due as soon as the lead is enrolled.');
  });
});
