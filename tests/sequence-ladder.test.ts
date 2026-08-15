import { describe, it, expect } from 'vitest';

import { computeStepDueDate } from '@/lib/sequences/engine';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import { buildJitterSeed } from '@/lib/automation/jitter';
import { getLocalTime } from '@/lib/automation/timezone';

/**
 * The three-step ladder (Plan 1 §A2).
 *
 * Every other automation test proves one decision in isolation. This one proves the *cadence*:
 * that a three-step email sequence walks 1 → 2 → 3 in order, that each step lands on the day and
 * inside the window its configuration asks for, and that nothing in the ladder moves when the
 * same schedule is recomputed — which is what a worker restart, a queue rebuild and a job retry
 * all do.
 *
 * ## Why the dates are business days, not "Day 0 / 3 / 7"
 *
 * The intended cadence is Email 1 at Day 0 09:00, Email 2 at Day 3 13:00, Email 3 at Day 7 10:30.
 * `computeStepDueDate` runs under `businessDayPolicy: 'skip_weekends'`, so a seven-calendar-day
 * gap is unreachable by construction: the weekend is skipped rather than consumed. The ladder
 * below therefore expresses the cadence in the unit the engine actually counts — business days —
 * and pins the resulting calendar dates exactly. Asserting literal calendar Day 7 would be
 * asserting that the weekend policy does not work.
 */

const TZ = 'Asia/Ho_Chi_Minh'; // UTC+7, no DST — an offset bug shows up as a whole-hour shift
const TENANT_ID = 'tenant-ladder';
const SEQUENCE_ID = 'seq-ladder';
const LEAD_ID = 'lead-ladder';

/** Monday 1 June 2026, 07:00 local (00:00Z) — before every window in the ladder. */
const ENROLLED_AT = new Date('2026-06-01T00:00:00.000Z');

type LadderStep = {
  id: string;
  order: number;
  channel: 'email';
  autoComplete: true;
  templateId: string;
  delayDays: number;
  delayHours: number;
  sendWindowStartMinutes: number;
  sendWindowEndMinutes: number;
};

const STEP_1: LadderStep = {
  id: 'step-1',
  order: 1,
  channel: 'email',
  autoComplete: true,
  templateId: 'tmpl-1',
  delayDays: 0,
  delayHours: 0,
  sendWindowStartMinutes: 9 * 60, // 09:00
  sendWindowEndMinutes: 10 * 60, // 10:00
};

const STEP_2: LadderStep = {
  ...STEP_1,
  id: 'step-2',
  order: 2,
  templateId: 'tmpl-2',
  delayDays: 3,
  sendWindowStartMinutes: 13 * 60, // 13:00
  sendWindowEndMinutes: 14 * 60, // 14:00
};

const STEP_3: LadderStep = {
  ...STEP_1,
  id: 'step-3',
  order: 3,
  templateId: 'tmpl-3',
  delayDays: 4,
  sendWindowStartMinutes: 10 * 60 + 30, // 10:30
  sendWindowEndMinutes: 11 * 60 + 30, // 11:30
};

const LADDER = [STEP_1, STEP_2, STEP_3];

function seedFor(step: LadderStep): string {
  return buildJitterSeed({
    tenantId: TENANT_ID,
    sequenceId: SEQUENCE_ID,
    sequenceStepId: step.id,
    leadId: LEAD_ID,
  });
}

/** Exactly what `computeStepDueDateForLead` does, minus the database read. */
function dueFor(step: LadderStep, baseAt: Date, leadId: string = LEAD_ID): Date {
  const seed = buildJitterSeed({
    tenantId: TENANT_ID,
    sequenceId: SEQUENCE_ID,
    sequenceStepId: step.id,
    leadId,
  });
  return computeStepDueDate(baseAt, step, { timezone: TZ, seed });
}

/** Walk the whole ladder the way the worker does: each step is based on the previous step's due time. */
function walkLadder(baseAt: Date = ENROLLED_AT): Date[] {
  const due: Date[] = [];
  let cursor = baseAt;
  for (const step of LADDER) {
    cursor = dueFor(step, cursor);
    due.push(cursor);
  }
  return due;
}

function localOf(at: Date) {
  return getLocalTime(at, TZ);
}

function minutesLocal(at: Date): number {
  const l = localOf(at);
  return l.hour * 60 + l.minute;
}

function isoDateLocal(at: Date): string {
  const l = localOf(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${l.year}-${pad(l.month)}-${pad(l.day)}`;
}

// ── Eligibility fixtures ──────────────────────────────────────────────────────

function eligibilityContext(over: {
  step: LadderStep;
  currentStep: number;
  now: Date;
}) {
  return {
    tenantId: TENANT_ID,
    enrollment: { status: 'active', currentStep: over.currentStep },
    lead: {
      id: LEAD_ID,
      email: 'prospect@acme.com',
      emailInvalid: false,
      archivedAt: null,
      stage: 'sequence_active',
      timezone: TZ,
    },
    user: { isActive: true, timezone: TZ },
    campaign: { status: 'active' },
    sequence: { id: SEQUENCE_ID, isActive: true, isArchived: false },
    step: over.step,
    template: { id: over.step.templateId },
    account: {
      isActive: true,
      sendPausedAt: null,
      sendPauseReason: null,
      healthLevel: 'healthy',
      dailyCap: 100,
      dailySendCount: 0,
    },
    isSuppressed: false,
    now: over.now,
  } as unknown as Parameters<typeof evaluateAutomationEligibility>[0];
}

describe('three-step email ladder — schedule', () => {
  it('places every step inside its own send window, on a weekday', () => {
    const [one, two, three] = walkLadder();

    for (const [step, at] of [
      [STEP_1, one],
      [STEP_2, two],
      [STEP_3, three],
    ] as const) {
      const minutes = minutesLocal(at);
      expect(minutes).toBeGreaterThanOrEqual(step.sendWindowStartMinutes);
      expect(minutes).toBeLessThan(step.sendWindowEndMinutes);
      // 0 = Sunday, 6 = Saturday
      expect([1, 2, 3, 4, 5]).toContain(localOf(at).dayOfWeek);
    }
  });

  it('lands on the business days the cadence asks for', () => {
    const [one, two, three] = walkLadder();

    // Monday, then +3 business days = Thursday.
    expect(isoDateLocal(one)).toBe('2026-06-01');
    expect(isoDateLocal(two)).toBe('2026-06-04');

    // +4 business days from Thursday is Wednesday 10 June — but step 2 completed at 13:xx and
    // step 3's window closes at 11:30, so Wednesday's slot is already gone when the cadence
    // arrives. The engine pushes to the next day's window rather than sending outside it.
    expect(isoDateLocal(three)).toBe('2026-06-11');
  });

  it('pushes to the next day rather than sending after a window has closed', () => {
    const [, two, three] = walkLadder();

    // The raw cadence time — before the window is applied — is the day the delay lands on.
    const rawCadenceDay = new Date(two.getTime() + 6 * 86_400_000); // Thu +4 business days = Wed
    expect(isoDateLocal(rawCadenceDay)).toBe('2026-06-10');

    expect(minutesLocal(two)).toBeGreaterThanOrEqual(STEP_3.sendWindowEndMinutes);
    expect(isoDateLocal(three)).toBe('2026-06-11');
    expect(minutesLocal(three)).toBeGreaterThanOrEqual(STEP_3.sendWindowStartMinutes);
    expect(minutesLocal(three)).toBeLessThan(STEP_3.sendWindowEndMinutes);
  });

  it('moves strictly forward — no step is ever due before the one that precedes it', () => {
    const [one, two, three] = walkLadder();
    expect(two.getTime()).toBeGreaterThan(one.getTime());
    expect(three.getTime()).toBeGreaterThan(two.getTime());
  });

  it('resolves the prospect timezone rather than the host timezone', () => {
    const seed = seedFor(STEP_1);
    const inHanoi = computeStepDueDate(ENROLLED_AT, STEP_1, { timezone: TZ, seed });
    const inLondon = computeStepDueDate(ENROLLED_AT, STEP_1, { timezone: 'Europe/London', seed });

    // Same wall-clock window, different zone — so the UTC instants must differ.
    expect(inHanoi.getTime()).not.toBe(inLondon.getTime());
    expect(minutesLocal(inHanoi)).toBeGreaterThanOrEqual(STEP_1.sendWindowStartMinutes);
    expect(getLocalTime(inLondon, 'Europe/London').hour).toBe(9);
  });

  it('snaps a step whose cadence lands before the window opens', () => {
    // 07:00 local base, 09:00 window: the raw cadence time is outside the window and must move up.
    expect(minutesLocal(ENROLLED_AT)).toBeLessThan(STEP_1.sendWindowStartMinutes);
    expect(minutesLocal(walkLadder()[0])).toBeGreaterThanOrEqual(STEP_1.sendWindowStartMinutes);
  });

  it('gives the same instant on every recomputation — a restart or rebuild cannot move the ladder', () => {
    const first = walkLadder();
    const second = walkLadder();
    const third = walkLadder();

    expect(second.map((d) => d.getTime())).toEqual(first.map((d) => d.getTime()));
    expect(third.map((d) => d.getTime())).toEqual(first.map((d) => d.getTime()));
  });

  it('rebuilds an individual step from its stored base without walking the schedule forward', () => {
    const [one, two] = walkLadder();

    // What a queue rebuild does: recompute step 2 from the same base the original run used.
    const rebuilt = dueFor(STEP_2, one);
    expect(rebuilt.getTime()).toBe(two.getTime());
  });

  it('buckets jitter per lead, so two prospects on the same step do not fire in lockstep', () => {
    const mine = dueFor(STEP_2, ENROLLED_AT, LEAD_ID);
    const theirs = dueFor(STEP_2, ENROLLED_AT, 'lead-other');

    expect(isoDateLocal(mine)).toBe(isoDateLocal(theirs));
    expect(mine.getTime()).not.toBe(theirs.getTime());
  });
});

describe('three-step email ladder — execution order', () => {
  const dueDates = walkLadder();

  it('makes step 1 the only immediately eligible step of a fresh enrollment', () => {
    const now = dueDates[0];

    expect(
      evaluateAutomationEligibility(eligibilityContext({ step: STEP_1, currentStep: 1, now }))
        .decision
    ).toBe('ALLOW');

    for (const ahead of [STEP_2, STEP_3]) {
      const result = evaluateAutomationEligibility(
        eligibilityContext({ step: ahead, currentStep: 1, now })
      );
      expect(result.decision).toBe('BLOCK');
      expect(result.reason).toBe('step_mismatch');
    }
  });

  it('refuses step 3 while the cadence is only on step 2 — no jumping ahead', () => {
    const result = evaluateAutomationEligibility(
      eligibilityContext({ step: STEP_3, currentStep: 2, now: dueDates[2] })
    );
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('step_mismatch');
  });

  it('refuses to re-run a step the cadence has already left behind', () => {
    // A stale delayed job for step 1 waking up after the enrollment advanced to step 2.
    const result = evaluateAutomationEligibility(
      eligibilityContext({ step: STEP_1, currentStep: 2, now: dueDates[1] })
    );
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('step_mismatch');
  });

  it('defers a step woken before its own window instead of sending early', () => {
    // Step 2's job fires at step 1's due time — inside the day, outside the 13:00 window.
    const result = evaluateAutomationEligibility(
      eligibilityContext({ step: STEP_2, currentStep: 2, now: dueDates[0] })
    );
    expect(result.decision).toBe('DEFER');
    expect(result.nextActionAt).toBeInstanceOf(Date);
    expect(minutesLocal(result.nextActionAt as Date)).toBeGreaterThanOrEqual(
      STEP_2.sendWindowStartMinutes
    );
  });

  it('stops the whole ladder the moment the prospect replies', () => {
    for (const step of LADDER) {
      const ctx = eligibilityContext({ step, currentStep: step.order, now: dueDates[step.order - 1] });
      const replied = { ...ctx, lead: { ...ctx.lead, stage: 'replied' } };
      const result = evaluateAutomationEligibility(
        replied as Parameters<typeof evaluateAutomationEligibility>[0]
      );
      expect(result.decision).toBe('BLOCK');
      expect(result.reason).toBe('lead_replied');
    }
  });
});
