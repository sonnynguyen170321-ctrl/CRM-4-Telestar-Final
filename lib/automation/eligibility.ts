/**
 * Central Eligibility Engine (spec §11–13).
 *
 * Workers do not invent policy. This function evaluates current CRM state
 * and returns one of 5 authoritative decisions:
 *   - ALLOW           : Proceed with automated execution right now
 *   - BLOCK           : Action permanently barred for this step (e.g. suppressed, bounced, replied)
 *   - DEFER           : Action valid but postponed (e.g. outside send window, quota reached)
 *   - TERMINATE       : Sequence run should end (e.g. lead stage closed)
 *   - MANUAL_REQUIRED : Cannot auto-send, requires SDR manual intervention (e.g. missing template)
 */

import type {
  AutomationEvaluationContext,
  EligibilityResult,
} from './types';
import { calculateNextActionAt } from './scheduling';
import { resolveTimezone } from './timezone';
import { buildJitterSeed } from './jitter';

export function evaluateAutomationEligibility(
  ctx: AutomationEvaluationContext
): EligibilityResult {
  const now = ctx.now ?? new Date();

  // 1. Multi-tenancy check
  if (!ctx.tenantId) {
    return { decision: 'BLOCK', reason: 'tenant_invalid' };
  }

  // 2. User active check
  if (ctx.user && ctx.user.isActive === false) {
    return { decision: 'BLOCK', reason: 'user_inactive' };
  }

  // 3. Campaign status check
  if (ctx.campaign && ctx.campaign.status !== 'active') {
    return { decision: 'BLOCK', reason: `campaign_${ctx.campaign.status}` };
  }

  // 4. Lead archived check
  if (ctx.lead.archivedAt) {
    return { decision: 'BLOCK', reason: 'lead_archived' };
  }

  // 5. Lead email invalid (hard bounce history)
  if (ctx.lead.emailInvalid) {
    return { decision: 'BLOCK', reason: 'lead_email_invalid' };
  }

  // 6. Lead stage checks (spec §20, §23, §24)
  if (ctx.lead.stage === 'replied') {
    return { decision: 'BLOCK', reason: 'lead_replied' };
  }
  if (ctx.lead.stage === 'meeting_booked') {
    return { decision: 'BLOCK', reason: 'meeting_booked' };
  }
  if (ctx.lead.stage === 'won' || ctx.lead.stage === 'lost') {
    return { decision: 'TERMINATE', reason: `lead_stage_${ctx.lead.stage}` };
  }

  // 7. Sequence status check
  if (ctx.sequence && (!ctx.sequence.isActive || ctx.sequence.isArchived)) {
    return { decision: 'BLOCK', reason: 'sequence_inactive' };
  }

  // 8. Enrollment status check
  if (ctx.enrollment && ctx.enrollment.status !== 'active') {
    return { decision: 'TERMINATE', reason: `enrollment_${ctx.enrollment.status}` };
  }

  // 9. Current step order mismatch check
  if (
    ctx.step &&
    ctx.enrollment &&
    ctx.step.order !== ctx.enrollment.currentStep
  ) {
    return { decision: 'BLOCK', reason: 'step_mismatch' };
  }

  // 10. Recipient suppression check
  if (ctx.isSuppressed) {
    return { decision: 'BLOCK', reason: 'recipient_suppressed' };
  }

  // 11. Lead email present & formatted
  if (!ctx.lead.email || !ctx.lead.email.includes('@')) {
    return { decision: 'BLOCK', reason: 'lead_email_missing' };
  }

  // 12. Non-automated or manual step checks
  if (ctx.step && !ctx.step.autoComplete) {
    return { decision: 'MANUAL_REQUIRED', reason: 'step_is_manual' };
  }

  // 13. Channel-specific checks (Email)
  if (ctx.step?.channel === 'email') {
    // Missing template
    if (!ctx.step.templateId || !ctx.template) {
      return { decision: 'MANUAL_REQUIRED', reason: 'missing_template' };
    }

    // Mailbox missing
    if (!ctx.account) {
      return { decision: 'MANUAL_REQUIRED', reason: 'no_connected_mailbox' };
    }

    // Mailbox inactive
    if (!ctx.account.isActive) {
      return { decision: 'BLOCK', reason: 'mailbox_inactive' };
    }

    // Mailbox manually paused
    if (Boolean(ctx.account.sendPausedAt)) {
      return {
        decision: 'DEFER',
        reason: 'mailbox_paused',
        details: { pauseReason: ctx.account.sendPauseReason },
      };
    }

    // Mailbox health critical check (with optional auto-pause env flag)
    if (
      ctx.account.healthLevel === 'critical' &&
      process.env.EMAIL_HEALTH_AUTOPAUSE === 'true'
    ) {
      return { decision: 'DEFER', reason: 'inbox_health_critical' };
    }

    // Quota exhausted (spec §14: DEFER, not permanent failure)
    if (
      ctx.account.dailyCap > 0 &&
      ctx.account.dailySendCount >= ctx.account.dailyCap
    ) {
      // Calculate next day window for rescheduling
      const timezone = resolveTimezone(
        ctx.lead.timezone,
        ctx.user?.timezone
      );
      const seed = buildJitterSeed({
        tenantId: ctx.tenantId,
        sequenceId: ctx.sequence?.id,
        sequenceStepId: ctx.step?.id,
        leadId: ctx.lead.id,
      });

      const sched = calculateNextActionAt({
        baseAt: now,
        delayDays: 1, // Push to tomorrow
        delayHours: 0,
        sendWindowStartMinutes: ctx.step?.sendWindowStartMinutes ?? null,
        sendWindowEndMinutes: ctx.step?.sendWindowEndMinutes ?? null,
        timezone,
        businessDayPolicy: 'skip_weekends',
        deterministicSeed: seed,
      });

      return {
        decision: 'DEFER',
        reason: 'daily_quota_exhausted',
        nextActionAt: sched.dueAtUtc,
        details: { dailyCap: ctx.account.dailyCap, dailySendCount: ctx.account.dailySendCount },
      };
    }
  } else if (ctx.step && ctx.step.channel !== 'email') {
    // Non-email channels require manual action for now
    return { decision: 'MANUAL_REQUIRED', reason: 'channel_requires_manual_action' };
  }

  // 14. Schedule / Send window check
  if (ctx.step) {
    const timezone = resolveTimezone(ctx.lead.timezone, ctx.user?.timezone);
    const seed = buildJitterSeed({
      tenantId: ctx.tenantId,
      sequenceId: ctx.sequence?.id,
      sequenceStepId: ctx.step.id,
      leadId: ctx.lead.id,
    });

    const sched = calculateNextActionAt({
      baseAt: now,
      delayDays: 0,
      delayHours: 0,
      sendWindowStartMinutes: ctx.step.sendWindowStartMinutes ?? null,
      sendWindowEndMinutes: ctx.step.sendWindowEndMinutes ?? null,
      timezone,
      businessDayPolicy: 'skip_weekends',
      deterministicSeed: seed,
    });

    // If calculated next time is in the future (e.g. outside send window or weekend)
    if (sched.dueAtUtc.getTime() > now.getTime() + 60_000) { // 1 min buffer
      return {
        decision: 'DEFER',
        reason: sched.adjustmentReason !== 'none' ? sched.adjustmentReason : 'outside_send_window',
        nextActionAt: sched.dueAtUtc,
        details: { dueAtLocal: sched.dueAtLocal, timezone: sched.timezone },
      };
    }
  }

  // 15. All checks passed!
  return { decision: 'ALLOW', reason: 'eligible' };
}
