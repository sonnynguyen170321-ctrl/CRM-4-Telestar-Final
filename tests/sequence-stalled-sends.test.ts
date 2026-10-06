import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import type { AutomationEvaluationContext } from '@/lib/automation/types';
import { describeHold } from '@/lib/sequences/holdReasons';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const { canSendNow, remainingToday, senderState } = await import('@/lib/sequences/sender');

/**
 * The ways a cadence step sat "overdue" with nothing sending it, reported 2026-10-05: a mailbox
 * that looked full forever, a mailbox chosen because it could not send, and a Run now that the
 * schedule overruled.
 */

// Monday 10:00 local time. Built from local parts because the quota day rolls at local midnight.
const NOW = new Date(2026, 9, 5, 10, 0, 0);
const TODAY = new Date(2026, 9, 5);
const YESTERDAY = new Date(2026, 9, 4);

function account(over: Record<string, unknown> = {}) {
  return {
    id: 'acct-1',
    isActive: true,
    sendPausedAt: null,
    sendPauseReason: null,
    healthLevel: null,
    dailyCap: 80,
    dailySendCount: 0,
    dailySendDate: null as Date | null,
    ...over,
  };
}

function context(over: Partial<AutomationEvaluationContext> = {}): AutomationEvaluationContext {
  return {
    tenantId: 't1',
    enrollment: { id: 'enr-1', status: 'active', currentStep: 1 },
    lead: {
      id: 'lead-1', email: 'prospect@acme.com', emailInvalid: false, stage: 'sequence_active',
      sequenceId: 'seq-1', sequenceStep: 1, sequenceStatus: 'active', assignedToId: 'user-1',
      campaignId: 'camp-1', archivedAt: null, timezone: 'UTC',
    },
    user: { id: 'user-1', isActive: true, timezone: 'UTC' },
    campaign: { id: 'camp-1', status: 'active' },
    sequence: { id: 'seq-1', isActive: true, isArchived: false, sendOnWeekends: false },
    step: { id: 'step-1', order: 1, channel: 'email', autoComplete: true, templateId: 'tmpl-1', delayDays: 0, delayHours: 0 },
    template: { id: 'tmpl-1', subject: 'Hi', body: 'Body' },
    account: account(),
    now: NOW,
    ...over,
  };
}

describe('daily limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('does not hold a step because the mailbox was full yesterday', () => {
    // The count is only reset by the send path. Read raw, yesterday's 80 of 80 deferred every
    // step, so nothing reached the send path to reset it — the mailbox never sent again.
    const result = evaluateAutomationEligibility(
      context({
        account: account({ dailySendCount: 80, dailySendDate: YESTERDAY }),
        // Weekends on, so the only thing under test is the limit: local Monday morning is still
        // Sunday in UTC for a machine far enough east.
        sequence: { id: 'seq-1', isActive: true, isArchived: false, sendOnWeekends: true },
      }),
    );
    expect(result.decision).toBe('ALLOW');
  });

  it('still defers when the mailbox has used today’s limit', () => {
    const result = evaluateAutomationEligibility(
      context({ account: account({ dailySendCount: 80, dailySendDate: TODAY }) }),
    );
    expect(result).toMatchObject({ decision: 'DEFER', reason: 'daily_quota_exhausted' });
  });

  it('keeps the raw count for a caller that does not pass the date', () => {
    const withoutDate = {
      id: 'acct-1', isActive: true, sendPausedAt: null, sendPauseReason: null, healthLevel: null,
      dailyCap: 80, dailySendCount: 80,
    };
    const result = evaluateAutomationEligibility(context({ account: withoutDate }));
    expect(result).toMatchObject({ decision: 'DEFER', reason: 'daily_quota_exhausted' });
  });
});

describe('Run now', () => {
  const windowed = {
    id: 'step-1', order: 1, channel: 'email', autoComplete: true, templateId: 'tmpl-1',
    delayDays: 0, delayHours: 0, sendWindowStartMinutes: 14 * 60, sendWindowEndMinutes: 16 * 60,
  };
  // 10:00 UTC on a Monday, four hours before the 14:00 window opens.
  const beforeWindow = new Date('2026-10-05T10:00:00Z');
  // 10:00 UTC on a Saturday, with weekends skipped.
  const saturday = new Date('2026-10-03T10:00:00Z');

  it('is held by the send window when it is the schedule running', () => {
    const result = evaluateAutomationEligibility(context({ step: windowed, now: beforeWindow }));
    expect(result).toMatchObject({ decision: 'DEFER', reason: 'before_send_window' });
  });

  it('sends outside the send window when a person asked for it', () => {
    const result = evaluateAutomationEligibility(context({ step: windowed, now: beforeWindow, ignoreSchedule: true }));
    expect(result.decision).toBe('ALLOW');
  });

  it('sends on a weekend when a person asked for it', () => {
    expect(evaluateAutomationEligibility(context({ now: saturday })).decision).toBe('DEFER');
    expect(evaluateAutomationEligibility(context({ now: saturday, ignoreSchedule: true })).decision).toBe('ALLOW');
  });

  it('does not override what protects the prospect or the mailbox', () => {
    const run = (over: Partial<AutomationEvaluationContext>) =>
      evaluateAutomationEligibility(context({ ignoreSchedule: true, ...over }));

    expect(run({ isSuppressed: true })).toMatchObject({ decision: 'BLOCK', reason: 'recipient_suppressed' });
    expect(run({ account: account({ sendPausedAt: new Date() }) })).toMatchObject({ decision: 'DEFER', reason: 'mailbox_paused' });
    expect(run({ account: account({ dailySendCount: 80, dailySendDate: TODAY }) })).toMatchObject({
      decision: 'DEFER', reason: 'daily_quota_exhausted',
    });
  });
});

describe('choosing a sender', () => {
  beforeEach(() => delete process.env.EMAIL_HEALTH_AUTOPAUSE);

  it('counts today’s sends from local midnight, like the send path', () => {
    expect(remainingToday(account({ dailySendCount: 30, dailySendDate: TODAY }), NOW)).toBe(50);
    expect(remainingToday(account({ dailySendCount: 30, dailySendDate: YESTERDAY }), NOW)).toBe(80);
  });

  it('does not treat a paused, full or disconnected mailbox as able to send', () => {
    expect(canSendNow(account(), NOW)).toBe(true);
    expect(canSendNow(account({ sendPausedAt: new Date() }), NOW)).toBe(false);
    expect(canSendNow(account({ isActive: false }), NOW)).toBe(false);
    expect(canSendNow(account({ dailySendCount: 80, dailySendDate: TODAY }), NOW)).toBe(false);
  });

  it('holds a critical mailbox only while auto-pause is on', () => {
    expect(canSendNow(account({ healthLevel: 'critical' }), NOW)).toBe(true);
    process.env.EMAIL_HEALTH_AUTOPAUSE = 'true';
    expect(canSendNow(account({ healthLevel: 'critical' }), NOW)).toBe(false);
    expect(senderState(account({ healthLevel: 'critical' }), NOW)).toBe('held');
  });

  it('names the state in the order the reasons would stop a send', () => {
    expect(senderState(account(), NOW)).toBe('sending');
    expect(senderState(account({ dailySendCount: 80, dailySendDate: TODAY }), NOW)).toBe('at_limit');
    expect(senderState(account({ sendPausedAt: new Date(), dailySendCount: 80, dailySendDate: TODAY }), NOW)).toBe('paused');
    expect(senderState(account({ isActive: false, sendPausedAt: new Date() }), NOW)).toBe('disconnected');
  });
});

describe('why a step is waiting', () => {
  it('says nothing when the step is not held', () => {
    expect(describeHold(null)).toBeNull();
    expect(describeHold('')).toBeNull();
  });

  it('separates a wait that clears itself from one that needs a person', () => {
    expect(describeHold('daily_quota_exhausted')).toMatchObject({ needsAction: false });
    expect(describeHold('weekend_adjustment')).toMatchObject({ needsAction: false });
    expect(describeHold('missing_template')).toMatchObject({ needsAction: true });
    expect(describeHold('mailbox_paused')).toMatchObject({ needsAction: true });
  });

  it('still shows a reason it has no wording for', () => {
    expect(describeHold('campaign_archived')?.label).toBe('Not sent: campaign archived');
  });
});
