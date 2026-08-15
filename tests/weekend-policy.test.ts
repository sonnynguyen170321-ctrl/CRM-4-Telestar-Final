import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import { calculateNextActionAt } from '@/lib/automation/scheduling';
import { getLocalTime } from '@/lib/automation/timezone';
import type { AutomationEvaluationContext } from '@/lib/automation/types';

/**
 * The weekend policy, asserted on purpose instead of by accident of the calendar.
 *
 * Merged `main` failed `Lint · types · tests` on a tree that had passed the evening before.
 * The tree had not changed; the day had. Five tests reported `DEFER / weekend_adjustment`
 * because CI ran on a Saturday, and the golden journey's steps 9-11 then asserted against a
 * message that was never sent. Pinning those suites to a weekday stops them being wrong, but
 * it also means nothing exercises the weekend branch at all — so this file exists to cover it
 * deliberately, at both levels, on all four boundary days.
 *
 * ## The contract this pins
 *
 * A null send window means **no hour-of-day restriction**. It does *not* mean "no scheduling
 * restriction". Send window and business-day policy are separate axes, which is what
 * `lib/automation/scheduling.ts` says in its header ("Policy = send window, business days,
 * timezone") and what `SchedulingInput` says field by field: `sendWindowStartMinutes` is
 * documented as "Null = no window", `businessDayPolicy` as "Whether to skip weekends".
 *
 * `tests/scheduling.test.ts` already pinned this at the scheduler: its "Saturday base snaps to
 * Monday" case runs on `defaults`, which carry `sendWindowStartMinutes: null`. So a Saturday
 * with no send window configured has always been specified to defer. Production is right, and
 * the golden journey was the side that was wrong.
 *
 * What was missing is the level where the breakage actually surfaced. `evaluateAutomationEligibility`
 * takes `now` as a parameter and is perfectly deterministic; `workers/sequence.ts` calls it with
 * `new Date()`, and that is where the real calendar enters the system. Nothing asserted that a
 * weekend defers *through* eligibility, so the only thing exercising that branch was the day of
 * the week CI happened to run.
 */

// Four boundary days in one week, at 10:00 UTC — inside any plausible business-hours window.
const MONDAY = new Date('2026-08-10T10:00:00Z');
const FRIDAY = new Date('2026-08-14T10:00:00Z');
const SATURDAY = new Date('2026-08-15T10:00:00Z');
const SUNDAY = new Date('2026-08-16T10:00:00Z');
/** Where both weekend days land once the policy has moved them. */
const NEXT_MONDAY = '2026-08-17';

const context = (now: Date, step: Partial<AutomationEvaluationContext['step']> = {}) =>
  ({
    tenantId: 'tenant-1',
    now,
    enrollment: { id: 'enr-1', status: 'active', currentStep: 1 },
    lead: {
      id: 'lead-1',
      email: 'prospect@acme.com',
      emailInvalid: false,
      stage: 'sequence_active',
      sequenceId: 'seq-1',
      sequenceStep: 1,
      sequenceStatus: 'active',
      assignedToId: 'user-1',
      campaignId: 'camp-1',
      archivedAt: null,
      timezone: 'UTC',
    },
    user: { id: 'user-1', isActive: true, timezone: 'UTC' },
    campaign: { id: 'camp-1', status: 'active' },
    sequence: { id: 'seq-1', isActive: true, isArchived: false },
    step: {
      id: 'step-1',
      order: 1,
      channel: 'email',
      autoComplete: true,
      templateId: 'tmpl-1',
      sendWindowStartMinutes: null,
      sendWindowEndMinutes: null,
      delayDays: 0,
      delayHours: 0,
      ...step,
    },
    template: { id: 'tmpl-1', subject: 'Hello', body: 'Hi {{firstName}}' },
    account: {
      id: 'acc-1',
      isActive: true,
      sendPausedAt: null,
      sendPauseReason: null,
      healthLevel: 'good',
      dailyCap: 100,
      dailySendCount: 10,
    },
    isSuppressed: false,
  }) as AutomationEvaluationContext;

describe('weekend policy — eligibility', () => {
  // ── No send window configured ────────────────────────────────────────────
  // The exact shape the golden journey uses, and the one whose behaviour was ambiguous.

  it('Monday with no send window is eligible now', () => {
    const result = evaluateAutomationEligibility(context(MONDAY));
    expect(result.decision).toBe('ALLOW');
    expect(result.reason).toBe('eligible');
  });

  it('Friday with no send window is eligible now', () => {
    const result = evaluateAutomationEligibility(context(FRIDAY));
    expect(result.decision).toBe('ALLOW');
    expect(result.reason).toBe('eligible');
  });

  it('Saturday with no send window defers to Monday', () => {
    const result = evaluateAutomationEligibility(context(SATURDAY));
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('weekend_adjustment');
    expect(result.nextActionAt!.toISOString()).toContain(NEXT_MONDAY);
  });

  it('Sunday with no send window defers to Monday', () => {
    const result = evaluateAutomationEligibility(context(SUNDAY));
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('weekend_adjustment');
    expect(result.nextActionAt!.toISOString()).toContain(NEXT_MONDAY);
  });

  // ── Send window configured ───────────────────────────────────────────────
  // Configuring an hour-of-day window must not change the weekend answer either way: the two
  // policies compose, they do not override one another.

  const WINDOW = { sendWindowStartMinutes: 9 * 60, sendWindowEndMinutes: 17 * 60 };

  it('Friday inside a 09:00-17:00 window is eligible now', () => {
    const result = evaluateAutomationEligibility(context(FRIDAY, WINDOW));
    expect(result.decision).toBe('ALLOW');
  });

  it('Saturday inside a 09:00-17:00 window still defers for the weekend, not the window', () => {
    const result = evaluateAutomationEligibility(context(SATURDAY, WINDOW));
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('weekend_adjustment');
    expect(result.nextActionAt!.toISOString()).toContain(NEXT_MONDAY);
  });

  it('Friday before a 09:00-17:00 window defers for the window, not the weekend', () => {
    const earlyFriday = new Date('2026-08-14T06:00:00Z');
    const result = evaluateAutomationEligibility(context(earlyFriday, WINDOW));
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('before_send_window');
    // Same day — a window adjustment must not silently consume a business day.
    expect(result.nextActionAt!.toISOString()).toContain('2026-08-14');
  });

  it('Friday after a 09:00-17:00 window defers past the weekend to Monday', () => {
    const lateFriday = new Date('2026-08-14T20:00:00Z');
    const result = evaluateAutomationEligibility(context(lateFriday, WINDOW));
    expect(result.decision).toBe('DEFER');
    // Saturday is not a legal landing place, so the answer is the weekend one.
    expect(result.reason).toBe('weekend_adjustment');
    expect(result.nextActionAt!.toISOString()).toContain(NEXT_MONDAY);
  });
});

describe('weekend policy — timezone is resolved, never assumed', () => {
  /**
   * A UTC instant is not a day. 2026-08-17T00:30:00Z is Monday in UTC and still Sunday in New
   * York, and the policy has to answer for the prospect's local calendar rather than the
   * server's. Without this, "skip weekends" quietly means "skip weekends in UTC".
   */
  const SUNDAY_NIGHT_IN_NEW_YORK = new Date('2026-08-17T00:30:00Z');

  it('is Monday in UTC and eligible', () => {
    expect(getLocalTime(SUNDAY_NIGHT_IN_NEW_YORK, 'UTC').dayOfWeek).toBe(1);
    const result = evaluateAutomationEligibility(context(SUNDAY_NIGHT_IN_NEW_YORK));
    expect(result.decision).toBe('ALLOW');
  });

  it('is still Sunday in America/New_York and defers', () => {
    expect(getLocalTime(SUNDAY_NIGHT_IN_NEW_YORK, 'America/New_York').dayOfWeek).toBe(0);
    const ctx = context(SUNDAY_NIGHT_IN_NEW_YORK);
    const result = evaluateAutomationEligibility({
      ...ctx,
      lead: { ...ctx.lead, timezone: 'America/New_York' },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('weekend_adjustment');
  });

  it('falls back to the assigned user timezone when the lead has none', () => {
    const ctx = context(SUNDAY_NIGHT_IN_NEW_YORK);
    const result = evaluateAutomationEligibility({
      ...ctx,
      lead: { ...ctx.lead, timezone: null },
      user: { id: 'user-1', isActive: true, timezone: 'America/New_York' },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('weekend_adjustment');
  });
});

describe('weekend policy — the scheduler agrees with the eligibility engine', () => {
  /**
   * `lib/automation/scheduling.ts` is the only thing allowed to compute a schedule, so the
   * boundary days are pinned against it directly too. `tests/scheduling.test.ts` covers the
   * Saturday case; Sunday and the both-days-land-on-the-same-Monday property are the ones that
   * were never asserted.
   */
  const base = {
    delayDays: 0,
    delayHours: 0,
    sendWindowStartMinutes: null,
    sendWindowEndMinutes: null,
    timezone: 'UTC',
    businessDayPolicy: 'skip_weekends' as const,
    deterministicSeed: null,
  };

  it.each([
    ['Monday', MONDAY, 'none', 1],
    ['Friday', FRIDAY, 'none', 5],
    ['Saturday', SATURDAY, 'weekend_adjustment', 1],
    ['Sunday', SUNDAY, 'weekend_adjustment', 1],
  ] as const)('%s → %s, landing on day %i', (_label, baseAt, reason, dayOfWeek) => {
    const result = calculateNextActionAt({ ...base, baseAt });
    expect(result.adjustmentReason).toBe(reason);
    expect(getLocalTime(result.dueAtUtc, 'UTC').dayOfWeek).toBe(dayOfWeek);
  });

  it('both weekend days land on the same Monday', () => {
    const fromSaturday = calculateNextActionAt({ ...base, baseAt: SATURDAY });
    const fromSunday = calculateNextActionAt({ ...base, baseAt: SUNDAY });
    expect(fromSaturday.dueAtUtc.toISOString().slice(0, 10)).toBe(NEXT_MONDAY);
    expect(fromSunday.dueAtUtc.toISOString().slice(0, 10)).toBe(NEXT_MONDAY);
  });

  it('businessDayPolicy "none" sends on a Saturday', () => {
    // The other half of the contract: the weekend rule is a policy, not a law of the module.
    const result = calculateNextActionAt({
      ...base,
      baseAt: SATURDAY,
      businessDayPolicy: 'none',
    });
    expect(result.adjustmentReason).toBe('none');
    expect(getLocalTime(result.dueAtUtc, 'UTC').dayOfWeek).toBe(6);
  });
});

describe('weekend policy — the day CI runs cannot change a test result', () => {
  /**
   * The regression itself. `workers/sequence.ts` calls `evaluateAutomationEligibility` with
   * `now: new Date()`, so the real calendar reaches the send path. Every suite that asserts a
   * send now pins its clock; this proves the pinning is what decides the outcome, by running
   * the identical evaluation under two pinned clocks and getting two different answers.
   */
  afterEach(() => {
    vi.useRealTimers();
  });

  const evaluateAtSystemClock = () =>
    evaluateAutomationEligibility(context(new Date()));

  it('defers when the system clock says Saturday', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SATURDAY);
    const result = evaluateAtSystemClock();
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('weekend_adjustment');
  });

  it('proceeds when the system clock says Wednesday', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-12T10:00:00Z'));
    const result = evaluateAtSystemClock();
    expect(result.decision).toBe('ALLOW');
  });
});
