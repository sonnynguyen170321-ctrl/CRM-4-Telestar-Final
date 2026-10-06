import { describe, expect, it } from 'vitest';

import { describeSendWindow, describeStepWait, describeWeekendRule } from '@/lib/sequences/stepDescription';

/**
 * The step card's wording. It replaced "Delay: 2d 0h" and a pair of empty time boxes labelled
 * "any time", which the sales team and its admin both reported they could not read.
 */
describe('describeStepWait', () => {
  const base = { delayDays: 2, delayHours: 0, previousOrder: 1, previousIsAutomatic: true, sendOnWeekends: false };

  it('says what the wait is measured from', () => {
    expect(describeStepWait({ ...base, previousOrder: null })).toBe('Due 2 business days after the lead is enrolled.');
    expect(describeStepWait(base)).toBe('Due 2 business days after step 1 is sent.');
    expect(describeStepWait({ ...base, previousIsAutomatic: false })).toBe('Due 2 business days after step 1 is completed.');
  });

  it('calls them business days only while the sequence skips weekends', () => {
    expect(describeStepWait({ ...base, sendOnWeekends: true })).toBe('Due 2 days after step 1 is sent.');
    expect(describeStepWait({ ...base, delayDays: 1 })).toBe('Due 1 business day after step 1 is sent.');
  });

  it('includes the hours, and handles no wait at all', () => {
    expect(describeStepWait({ ...base, delayHours: 3 })).toBe('Due 2 business days and 3 hours after step 1 is sent.');
    expect(describeStepWait({ ...base, delayDays: 0, delayHours: 1 })).toBe('Due 1 hour after step 1 is sent.');
    expect(describeStepWait({ ...base, delayDays: 0, previousOrder: null })).toBe('Due as soon as the lead is enrolled.');
  });
});

describe('describeSendWindow', () => {
  it('says what two empty boxes mean', () => {
    expect(describeSendWindow(null, null)).toMatch(/^No time limit/);
    expect(describeSendWindow(undefined, undefined)).toMatch(/^No time limit/);
  });

  it('names the window and whose clock it runs on', () => {
    const text = describeSendWindow(9 * 60, 17 * 60 + 30);
    expect(text).toContain('between 09:00 and 17:30');
    expect(text).toContain('lead’s timezone');
  });

  it('flags the two states the API refuses', () => {
    expect(describeSendWindow(540, null)).toBe('Set both times, or clear them.');
    expect(describeSendWindow(600, 540)).toBe('The end time must be after the start time.');
  });
});

describe('describeWeekendRule', () => {
  it('states the rule either way', () => {
    expect(describeWeekendRule(false)).toMatch(/^Weekends are skipped/);
    expect(describeWeekendRule(true)).toMatch(/also sends on weekends/);
  });
});
