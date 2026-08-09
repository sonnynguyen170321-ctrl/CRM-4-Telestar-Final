import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import type { AutomationEvaluationContext } from '@/lib/automation/types';
import { handleEmailSend, evaluateSendBlock } from '@/workers/email';

describe('Production Safety Regressions (Spec §52 / Phase 7)', () => {
  const mondayMorning = new Date('2026-08-10T10:00:00Z');

  const context: AutomationEvaluationContext = {
    tenantId: 'tenant-1',
    now: mondayMorning,
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
    },
    template: { id: 'tmpl-1', subject: 'Hi', body: 'Body' },
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

  // ── Safety 1: Reply before delayed job wakes → no send ───────────────────
  it('Safety 1: reply before delayed job wakes → blocks send', () => {
    const result = evaluateAutomationEligibility({
      ...context,
      lead: { ...context.lead, stage: 'replied' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('lead_replied');
  });

  // ── Safety 2: Hard bounce before delayed job wakes → no send ────────────
  it('Safety 2: hard bounce before delayed job wakes → blocks send', () => {
    const result = evaluateAutomationEligibility({
      ...context,
      lead: { ...context.lead, emailInvalid: true },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('lead_email_invalid');
  });

  // ── Safety 3: Meeting before delayed job wakes → no send ────────────────
  it('Safety 3: meeting booked before delayed job wakes → blocks send', () => {
    const result = evaluateAutomationEligibility({
      ...context,
      lead: { ...context.lead, stage: 'meeting_booked' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('meeting_booked');
  });

  // ── Safety 4: Suppression added after scheduling → no send ─────────────
  it('Safety 4: suppression added after scheduling → blocks send', () => {
    const result = evaluateAutomationEligibility({
      ...context,
      isSuppressed: true,
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('recipient_suppressed');
  });

  // ── Safety 5: Mailbox paused after scheduling → no send ────────────────
  it('Safety 5: mailbox paused after scheduling → defers send', () => {
    const result = evaluateAutomationEligibility({
      ...context,
      account: {
        ...context.account!,
        sendPausedAt: new Date(),
        sendPauseReason: 'Deliverability review',
      },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('mailbox_paused');
  });

  // ── Safety 6: Mailbox inactive → blocks send ────────────────────────────
  it('Safety 6: mailbox inactive at execution time → blocks send', () => {
    const block = evaluateSendBlock({
      isActive: false,
      sendPausedAt: null,
      sendPauseReason: null,
      healthLevel: 'good',
    });
    expect(block).not.toBeNull();
    expect(block!.reason).toBe('account_inactive');
  });

  // ── Safety 7: Mailbox paused in email worker → blocks send ───────────────
  it('Safety 7: mailbox paused in email worker → blocks send', () => {
    const block = evaluateSendBlock({
      isActive: true,
      sendPausedAt: new Date(),
      sendPauseReason: 'Warmup',
      healthLevel: 'good',
    });
    expect(block).not.toBeNull();
    expect(block!.reason).toBe('account_paused');
  });

  // ── Safety 8: Lead archived after scheduling → blocks send ─────────────
  it('Safety 8: lead archived after scheduling → blocks send', () => {
    const result = evaluateAutomationEligibility({
      ...context,
      lead: { ...context.lead, archivedAt: new Date() },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('lead_archived');
  });
});
