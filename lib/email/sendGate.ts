/**
 * The checks that decide whether a send may be queued, shared by every route that queues one.
 *
 * Two layers, on purpose. The worker (`workers/email.ts`) is the last gate and still runs these
 * checks right before the provider call. The routes run them first, while the rep is looking at
 * the composer: a refusal found only by the worker leaves a `failed` row nobody on screen was
 * told about. A route that skipped them answered 200 and the UI said "sent".
 */
import { findSuppression } from '@/lib/email/suppress';

/** Minimal account shape the deliverability preflight needs. */
export type SendGateAccount = {
  isActive: boolean;
  sendPausedAt: Date | null;
  sendPauseReason: string | null;
  healthLevel: string | null;
};

/**
 * Decides whether the deliverability layer blocks this send.
 *
 * A manager-set pause is an unconditional hard block. A critical health score is
 * advisory by default — it raises alerts, but only stops sending when
 * EMAIL_HEALTH_AUTOPAUSE is explicitly enabled, so a miscalibrated threshold
 * cannot silently halt a live client campaign.
 *
 * Pure so it needs no database.
 */
export function evaluateSendBlock(
  account: SendGateAccount
): { reason: string; errorMessage: string } | null {
  if (!account.isActive) {
    return { reason: 'account_inactive', errorMessage: 'Email account is inactive' };
  }

  if (account.sendPausedAt !== null) {
    const why = account.sendPauseReason ? `: ${account.sendPauseReason}` : '';
    return { reason: 'account_paused', errorMessage: `Sending is paused for this inbox${why}` };
  }

  if (account.healthLevel === 'critical' && process.env.EMAIL_HEALTH_AUTOPAUSE === 'true') {
    return {
      reason: 'health_critical',
      errorMessage: 'Inbox health is critical and auto-pause is enabled',
    };
  }

  return null;
}

/** A refusal a route answers with, before anything is queued. */
export interface QueueRefusal {
  status: number;
  code: 'mailbox_inactive' | 'mailbox_paused' | 'mailbox_unhealthy' | 'recipient_suppressed' | 'recipient_invalid';
  error: string;
}

const MAILBOX_CODE: Record<string, QueueRefusal['code']> = {
  account_inactive: 'mailbox_inactive',
  account_paused: 'mailbox_paused',
  health_critical: 'mailbox_unhealthy',
};

/** The mailbox half of the pre-queue checks. Wording for a pause is what the composer shows. */
export function mailboxRefusal(
  account: SendGateAccount & { email: string }
): QueueRefusal | null {
  const block = evaluateSendBlock(account);
  if (!block) return null;
  const code = MAILBOX_CODE[block.reason] ?? 'mailbox_paused';
  if (code === 'mailbox_paused') {
    const why = account.sendPauseReason ? `: ${account.sendPauseReason}` : '';
    return {
      status: 409,
      code,
      error: `Sending is paused for ${account.email}${why}. A manager can resume it under Email Health.`,
    };
  }
  if (code === 'mailbox_inactive') {
    return { status: 409, code, error: `${account.email} is disconnected. Reconnect it in Settings.` };
  }
  return {
    status: 409,
    code,
    error: `Inbox health for ${account.email} is critical and sending is stopped. A manager can review it under Email Health.`,
  };
}

/** The recipient half: suppression (unsubscribe, bounce, manual do-not-contact) and invalid addresses. */
export async function recipientRefusal(input: {
  tenantId: string;
  email: string;
  campaignId?: string | null;
  emailInvalid?: boolean;
}): Promise<QueueRefusal | null> {
  const suppressed = await findSuppression({
    tenantId: input.tenantId,
    email: input.email,
    campaignId: input.campaignId,
  });
  if (suppressed) {
    return { status: 403, code: 'recipient_suppressed', error: 'Recipient is suppressed' };
  }
  if (input.emailInvalid) {
    return {
      status: 403,
      code: 'recipient_invalid',
      error: 'This address is marked invalid (it bounced earlier), so nothing is sent to it.',
    };
  }
  return null;
}
