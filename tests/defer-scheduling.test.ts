import { describe, it, expect } from 'vitest';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import type { AutomationEvaluationContext } from '@/lib/automation/types';

describe('Deferred Scheduling (Phase 6)', () => {
  const mondayMorning = new Date('2026-08-10T08:00:00Z'); // 08:00 UTC Monday

  const context: AutomationEvaluationContext = {
    tenantId: 'tenant-1',
    now: mondayMorning,
    enrollment: { id: 'enr-1', status: 'active', currentStep: 1 },
    lead: {
      id: 'lead-1',
      email: 'prospect@corp.com',
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
      sendWindowStartMinutes: 540, // 09:00 UTC
      sendWindowEndMinutes: 660,   // 11:00 UTC
      delayDays: 0,
      delayHours: 0,
    },
    template: { id: 'tmpl-1', subject: 'Subject', body: 'Body' },
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
  };

  it('defers execution when evaluated before send window starts', () => {
    // Current time is 08:00 UTC, window starts at 09:00 UTC
    const result = evaluateAutomationEligibility(context);
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('before_send_window');
    expect(result.nextActionAt).toBeDefined();
    expect(result.nextActionAt!.getUTCHours()).toBeGreaterThanOrEqual(9);
  });

  it('defers execution when daily quota is exhausted', () => {
    // 09:30 UTC — inside send window, but quota exhausted (100 / 100)
    const insideWindow = new Date('2026-08-10T09:30:00Z');
    const result = evaluateAutomationEligibility({
      ...context,
      now: insideWindow,
      account: { ...context.account!, dailyCap: 100, dailySendCount: 100 },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('daily_quota_exhausted');
    expect(result.nextActionAt).toBeDefined();
    // Next action pushed to next day
    expect(result.nextActionAt!.getTime()).toBeGreaterThan(insideWindow.getTime());
  });

  it('defers execution when inbox is manually paused', () => {
    const insideWindow = new Date('2026-08-10T09:30:00Z');
    const result = evaluateAutomationEligibility({
      ...context,
      now: insideWindow,
      account: {
        ...context.account!,
        sendPausedAt: new Date('2026-08-01T00:00:00Z'),
        sendPauseReason: 'Warmup adjustment',
      },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('mailbox_paused');
  });

  it('allows execution when inside send window with available quota', () => {
    const insideWindow = new Date('2026-08-10T09:30:00Z');
    const result = evaluateAutomationEligibility({
      ...context,
      now: insideWindow,
    });
    expect(result.decision).toBe('ALLOW');
    expect(result.reason).toBe('eligible');
  });
});
