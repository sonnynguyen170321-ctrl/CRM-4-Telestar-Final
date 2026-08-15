import type { PausedReason } from './types';
import { PAUSED_REASON_LABELS, normalizePausedReason } from './types';

/**
 * Why a prospect has not received their next email — in words an operator can act on.
 *
 * `/automation` could already show that *something* was scheduled, but not why nothing had
 * happened. Answering "why did Email 2 not go out today?" meant opening the lead panel, and even
 * there the answer was a `pausedReason` token or nothing at all. This module turns the state the
 * automation engine already stores into one answer per cadence.
 *
 * ## Two vocabularies, deliberately
 *
 * `reasonCode` is machine-stable: tests, filters and future alerting key on it. `reasonLabel` and
 * `detail` are what a human reads, and they never mention a queue, a job, a worker, a BullMQ
 * state or an eligibility decision. An operator does not need to know that `DEFER` exists to
 * understand "waiting for mailbox capacity" — and exposing the enum would make the internal
 * vocabulary a public contract we then could not change.
 *
 * ## No new state
 *
 * Everything here is derived from columns the engine already writes: `SequenceEnrollment.status`,
 * `nextActionAt`, `pausedReason`, the current step's task, and the mailbox row. Adding a stored
 * "reason" column would create a second source of truth that could disagree with the enrollment —
 * exactly the drift `ARCHITECTURE.md` forbids. If this function and the engine ever disagree, the
 * engine is right and this is the bug.
 */

export type OperatorReasonCode =
  /** Running normally; the next step is scheduled and simply not due yet. */
  | 'waiting_for_next_step'
  /** Due, but the step's send window is closed right now. */
  | 'outside_send_window'
  /** Due, but the mailbox has used its allowance for the day. */
  | 'quota_deferred'
  /** Held by the deliverability layer — a paused or unhealthy mailbox. */
  | 'deliverability_hold'
  /** The SDR has no usable mailbox connected, so nothing can be sent for them. */
  | 'mailbox_unavailable'
  /** The prospect replied; a human owns the conversation now. */
  | 'prospect_replied'
  /** A meeting exists — outreach has done its job. */
  | 'meeting_booked'
  /** The address hard-bounced. */
  | 'email_bounced'
  /** A human paused this cadence. */
  | 'paused_by_user'
  /** The campaign this prospect belongs to is not running. */
  | 'campaign_paused'
  /** A step was attempted and will be tried again. */
  | 'retry_pending'
  /** The cadence finished or was stopped; nothing further is expected. */
  | 'finished';

export interface OperatorReason {
  reasonCode: OperatorReasonCode;
  /** Short label for a badge or a table cell. */
  reasonLabel: string;
  /** One sentence naming the specific prospect-facing consequence. */
  detail: string;
  /** When the cadence expects to act next, when that is knowable. */
  nextActionAt: Date | null;
  /** True when a human has to do something before this moves. */
  needsAttention: boolean;
}

/** The minimum an enrollment has to expose for a reason to be derived. */
export interface OperatorStateInput {
  enrollment: {
    status: string;
    currentStep: number;
    nextActionAt: Date | null;
    pausedReason: string | null;
  };
  /** The current step's task, when one exists. */
  task?: {
    status: string;
    dueDate: Date | null;
  } | null;
  /** The mailbox the assigned SDR would send from. Null means none is connected. */
  account?: {
    isActive: boolean;
    sendPausedAt: Date | null;
    dailyCap: number;
    dailySendCount: number;
    dailySendDate: Date | null;
    healthLevel: string | null;
  } | null;
  /** Label for the step, e.g. "Email 2" — used in `detail` so the sentence names the real step. */
  stepLabel?: string;
  now?: Date;
}

const PAUSED_REASON_CODES: Record<PausedReason, OperatorReasonCode> = {
  reply: 'prospect_replied',
  hard_bounce: 'email_bounced',
  soft_bounce: 'retry_pending',
  meeting_booked: 'meeting_booked',
  manual: 'paused_by_user',
  email_health: 'deliverability_hold',
  campaign_paused: 'campaign_paused',
  mailbox_unavailable: 'mailbox_unavailable',
};

const LABELS: Record<OperatorReasonCode, string> = {
  waiting_for_next_step: 'Waiting for the next step',
  outside_send_window: 'Outside sending hours',
  quota_deferred: 'Waiting for mailbox capacity',
  deliverability_hold: 'Sending on hold',
  mailbox_unavailable: 'Needs attention — mailbox unavailable',
  prospect_replied: 'Paused — prospect replied',
  meeting_booked: 'Stopped — meeting booked',
  email_bounced: 'Stopped — email bounced',
  paused_by_user: 'Paused by a person',
  campaign_paused: 'Campaign is paused',
  retry_pending: 'Retrying shortly',
  finished: 'Finished',
};

/** Reasons a human has to resolve. Everything else clears on its own. */
const ATTENTION_CODES: ReadonlySet<OperatorReasonCode> = new Set<OperatorReasonCode>([
  'mailbox_unavailable',
  'deliverability_hold',
  'campaign_paused',
]);

function isQuotaExhausted(
  account: NonNullable<OperatorStateInput['account']>,
  now: Date
): boolean {
  if (account.dailyCap <= 0) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // A count from a previous day has already reset in effect, even if the row still holds it.
  if (!account.dailySendDate || account.dailySendDate < today) return false;
  return account.dailySendCount >= account.dailyCap;
}

function build(
  reasonCode: OperatorReasonCode,
  detail: string,
  nextActionAt: Date | null
): OperatorReason {
  return {
    reasonCode,
    reasonLabel: LABELS[reasonCode],
    detail,
    nextActionAt,
    needsAttention: ATTENTION_CODES.has(reasonCode),
  };
}

/**
 * Derive the single reason to show for one enrollment.
 *
 * Order matters and is not arbitrary: a stopped cadence is reported as stopped even if its
 * mailbox is also unavailable, because telling an operator to fix a mailbox for a prospect who
 * has already replied sends them to the wrong screen.
 */
export function deriveOperatorReason(input: OperatorStateInput): OperatorReason {
  const now = input.now ?? new Date();
  const step = input.stepLabel ?? `Step ${input.enrollment.currentStep}`;
  const { enrollment } = input;

  // 1. Terminal first — nothing else is worth saying about a finished cadence.
  if (enrollment.status === 'completed' || enrollment.status === 'unenrolled') {
    return build('finished', `${step} will not be sent — this sequence is no longer running.`, null);
  }

  // 2. A paused cadence already carries its own recorded reason. Use it rather than re-deriving
  //    one, so the operator sees the same explanation the timeline recorded.
  if (enrollment.status === 'paused') {
    const paused = normalizePausedReason(enrollment.pausedReason ?? 'manual');
    const code = PAUSED_REASON_CODES[paused];
    return build(
      code,
      `${step} is on hold — ${PAUSED_REASON_LABELS[paused]}.`,
      code === 'retry_pending' ? enrollment.nextActionAt : null
    );
  }

  // 3. Active, but the mailbox cannot send. This outranks the schedule: the clock is irrelevant
  //    while there is nothing to send from.
  const account = input.account;
  if (!account || !account.isActive) {
    return build(
      'mailbox_unavailable',
      `${step} cannot be sent — the assigned rep has no active mailbox connected.`,
      null
    );
  }
  if (account.sendPausedAt) {
    return build('deliverability_hold', `${step} is held — sending is paused for this mailbox.`, null);
  }
  if (isQuotaExhausted(account, now)) {
    return build(
      'quota_deferred',
      `${step} is scheduled to retry after the mailbox quota resets.`,
      enrollment.nextActionAt
    );
  }

  // 4. Scheduled and simply not due yet — the overwhelmingly common case.
  const dueAt = enrollment.nextActionAt ?? input.task?.dueDate ?? null;
  if (dueAt && dueAt.getTime() > now.getTime()) {
    return build('waiting_for_next_step', `${step} is scheduled for ${formatDue(dueAt)}.`, dueAt);
  }

  // 5. Due, or overdue, and still pending. The engine re-evaluates the send window at execution,
  //    so an overdue-but-pending step is one the window has not reopened for.
  if (input.task?.status === 'pending') {
    return build(
      'outside_send_window',
      `${step} is due but outside its sending hours — it will go out when the window reopens.`,
      dueAt
    );
  }

  return build('waiting_for_next_step', `${step} is scheduled.`, dueAt);
}

/** A compact, locale-independent rendering — the UI does the pretty formatting. */
function formatDue(at: Date): string {
  return at.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export const OPERATOR_REASON_LABELS = LABELS;
