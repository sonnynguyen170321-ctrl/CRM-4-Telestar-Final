import { describe, it, expect } from 'vitest';
import { evaluateAutomationEligibility } from '@/lib/automation/eligibility';
import type { AutomationEvaluationContext } from '@/lib/automation/types';

describe('evaluateAutomationEligibility', () => {
  const now = new Date('2026-08-10T10:00:00Z'); // Monday 10:00 UTC

  const baseContext: AutomationEvaluationContext = {
    tenantId: 'tenant-1',
    now,
    enrollment: {
      id: 'enr-1',
      status: 'active',
      currentStep: 1,
    },
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
    user: {
      id: 'user-1',
      isActive: true,
      timezone: 'UTC',
    },
    campaign: {
      id: 'camp-1',
      status: 'active',
    },
    sequence: {
      id: 'seq-1',
      isActive: true,
      isArchived: false,
    },
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
    template: {
      id: 'tmpl-1',
      subject: 'Hello',
      body: 'Hi {{firstName}}',
    },
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

  it('returns ALLOW for fully eligible context', () => {
    const result = evaluateAutomationEligibility(baseContext);
    expect(result.decision).toBe('ALLOW');
    expect(result.reason).toBe('eligible');
  });

  // ── 1. Tenant check ────────────────────────────────────────────────────────
  it('blocks if tenantId is missing', () => {
    const result = evaluateAutomationEligibility({ ...baseContext, tenantId: '' });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('tenant_invalid');
  });

  // ── 2. User active check ───────────────────────────────────────────────────
  it('blocks if assigned user is inactive', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      user: { id: 'user-1', isActive: false },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('user_inactive');
  });

  // ── 3. Campaign active check ───────────────────────────────────────────────
  it('blocks if campaign is paused', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      campaign: { id: 'camp-1', status: 'paused' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('campaign_paused');
  });

  // ── 4. Lead archived check ─────────────────────────────────────────────────
  it('blocks if lead is archived', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      lead: { ...baseContext.lead, archivedAt: new Date() },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('lead_archived');
  });

  // ── 5. Lead email invalid ──────────────────────────────────────────────────
  it('blocks if lead email is flagged invalid', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      lead: { ...baseContext.lead, emailInvalid: true },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('lead_email_invalid');
  });

  // ── 6. Lead stage checks ───────────────────────────────────────────────────
  it('blocks if lead replied', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      lead: { ...baseContext.lead, stage: 'replied' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('lead_replied');
  });

  it('blocks if meeting booked', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      lead: { ...baseContext.lead, stage: 'meeting_booked' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('meeting_booked');
  });

  it('terminates if lead is won or lost', () => {
    const resultWon = evaluateAutomationEligibility({
      ...baseContext,
      lead: { ...baseContext.lead, stage: 'won' },
    });
    expect(resultWon.decision).toBe('TERMINATE');
    expect(resultWon.reason).toBe('lead_stage_won');

    const resultLost = evaluateAutomationEligibility({
      ...baseContext,
      lead: { ...baseContext.lead, stage: 'lost' },
    });
    expect(resultLost.decision).toBe('TERMINATE');
    expect(resultLost.reason).toBe('lead_stage_lost');
  });

  // ── 7. Sequence status check ───────────────────────────────────────────────
  it('blocks if sequence is inactive or archived', () => {
    const resultInactive = evaluateAutomationEligibility({
      ...baseContext,
      sequence: { id: 'seq-1', isActive: false, isArchived: false },
    });
    expect(resultInactive.decision).toBe('BLOCK');
    expect(resultInactive.reason).toBe('sequence_inactive');
  });

  // ── 8. Enrollment status check ─────────────────────────────────────────────
  it('terminates if enrollment is not active', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      enrollment: { id: 'enr-1', status: 'paused', currentStep: 1 },
    });
    expect(result.decision).toBe('TERMINATE');
    expect(result.reason).toBe('enrollment_paused');
  });

  // ── 9. Step mismatch check ─────────────────────────────────────────────────
  it('blocks if step order does not match enrollment currentStep', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      step: { ...baseContext.step!, order: 2 },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('step_mismatch');
  });

  // ── 10. Suppression check ─────────────────────────────────────────────────
  it('blocks if recipient is suppressed', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      isSuppressed: true,
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('recipient_suppressed');
  });

  // ── 11. Lead email present check ──────────────────────────────────────────
  it('blocks if lead email is missing or malformed', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      lead: { ...baseContext.lead, email: '' },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('lead_email_missing');
  });

  // ── 12. Template & Mailbox checks (MANUAL_REQUIRED) ────────────────────────
  it('requires manual action if step has no template', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      template: null,
    });
    expect(result.decision).toBe('MANUAL_REQUIRED');
    expect(result.reason).toBe('missing_template');
  });

  it('requires manual action if no connected mailbox', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      account: null,
    });
    expect(result.decision).toBe('MANUAL_REQUIRED');
    expect(result.reason).toBe('no_connected_mailbox');
  });

  it('blocks if mailbox is inactive', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      account: { ...baseContext.account!, isActive: false },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('mailbox_inactive');
  });

  // ── 13. Mailbox pause & Quota (DEFER) ──────────────────────────────────────
  it('defers if mailbox sending is paused', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      account: { ...baseContext.account!, sendPausedAt: new Date(), sendPauseReason: 'warmup' },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('mailbox_paused');
  });

  it('defers if daily quota is exhausted (spec §14)', () => {
    const result = evaluateAutomationEligibility({
      ...baseContext,
      account: { ...baseContext.account!, dailyCap: 50, dailySendCount: 50 },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('daily_quota_exhausted');
    expect(result.nextActionAt).toBeDefined();
    expect(result.nextActionAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  // ── 14. Send window / Schedule checks (DEFER) ─────────────────────────────
  it('defers if current time is outside send window', () => {
    // Current time: 10:00 UTC. Send window: 13:00 - 15:00 UTC (780 - 900 minutes)
    const result = evaluateAutomationEligibility({
      ...baseContext,
      step: {
        ...baseContext.step!,
        sendWindowStartMinutes: 780, // 13:00
        sendWindowEndMinutes: 900,   // 15:00
      },
    });
    expect(result.decision).toBe('DEFER');
    expect(result.reason).toBe('before_send_window');
    expect(result.nextActionAt).toBeDefined();
  });
});
