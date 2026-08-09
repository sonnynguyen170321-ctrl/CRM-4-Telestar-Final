/**
 * Automation Engine shared type definitions (Phase 4).
 */

export type EligibilityDecision =
  | 'ALLOW'
  | 'BLOCK'
  | 'DEFER'
  | 'TERMINATE'
  | 'MANUAL_REQUIRED';

/**
 * Why a sequence run is paused. This is the **only** vocabulary for
 * `SequenceEnrollment.pausedReason` — writer, reader and schema comment all resolve here.
 *
 * They did not always. `pauseSequence` used to declare its own four-value list
 * (`replied` / `bounced` / `meeting_booked` / `manual`) while the lead panel rendered
 * labels keyed on the eight below, so a reply-paused enrollment stored `replied`, missed
 * every key in the map, and displayed the raw token. Two of the eight overlapped. Keep the
 * type, the labels and the normalizer in one file so the next divergence cannot compile.
 */
export type PausedReason =
  | 'reply'
  | 'hard_bounce'
  | 'soft_bounce'
  | 'meeting_booked'
  | 'manual'
  | 'email_health'
  | 'campaign_paused'
  | 'mailbox_unavailable';

/** Display labels. The UI must render these rather than keying its own map. */
export const PAUSED_REASON_LABELS: Record<PausedReason, string> = {
  reply: 'prospect replied',
  hard_bounce: 'hard bounce',
  soft_bounce: 'soft bounce',
  meeting_booked: 'meeting booked',
  manual: 'manually paused',
  email_health: 'mailbox health',
  campaign_paused: 'campaign paused',
  mailbox_unavailable: 'mailbox unavailable',
};

/**
 * Values written before the vocabularies were collapsed, plus any BullMQ job that was
 * already queued with the old payload shape. `normalizePausedReason` is applied at the
 * single write site, so a stale caller cannot reintroduce a token the UI cannot render.
 */
const LEGACY_PAUSED_REASONS: Record<string, PausedReason> = {
  replied: 'reply',
  bounced: 'hard_bounce',
};

export function normalizePausedReason(reason: string): PausedReason {
  if (reason in PAUSED_REASON_LABELS) return reason as PausedReason;
  return LEGACY_PAUSED_REASONS[reason] ?? 'manual';
}

export interface EligibilityResult {
  decision: EligibilityDecision;
  /** Human-readable machine-stable code explaining the decision. */
  reason: string;
  /** When DEFER is chosen, the calculated next eligible timestamp. */
  nextActionAt?: Date;
  /** Optional metadata giving structured context for logs/activity. */
  details?: Record<string, unknown>;
}

export interface AutomationEvaluationContext {
  /** Tenant ID for multi-tenancy verification. */
  tenantId: string;
  /** Sequence enrollment record (if any). */
  enrollment?: {
    id: string;
    status: string;
    currentStep: number;
  } | null;
  /** Lead record. */
  lead: {
    id: string;
    email: string;
    emailInvalid: boolean;
    stage: string;
    sequenceId: string | null;
    sequenceStep: number | null;
    sequenceStatus: string | null;
    assignedToId: string;
    campaignId: string;
    archivedAt: Date | null;
    timezone?: string | null;
  };
  /** User record (assigned SDR). */
  user?: {
    id: string;
    isActive?: boolean;
    timezone?: string | null;
  } | null;
  /** Campaign record. */
  campaign?: {
    id: string;
    status: string; // active | paused | completed
  } | null;
  /** Sequence record. */
  sequence?: {
    id: string;
    isActive: boolean;
    isArchived: boolean;
  } | null;
  /** Sequence step record. */
  step?: {
    id: string;
    order: number;
    channel: string;
    autoComplete: boolean;
    templateId: string | null;
    sendWindowStartMinutes?: number | null;
    sendWindowEndMinutes?: number | null;
    delayDays: number;
    delayHours: number;
  } | null;
  /** Template record (if applicable). */
  template?: {
    id: string;
    subject?: string | null;
    body: string;
  } | null;
  /** Email account for sending (if applicable). */
  account?: {
    id: string;
    isActive: boolean;
    sendPausedAt: Date | null;
    sendPauseReason: string | null;
    healthLevel: string | null;
    dailyCap: number;
    dailySendCount: number;
  } | null;
  /** Recipient suppression match (if checked). */
  isSuppressed?: boolean;
  /** Current evaluation timestamp (defaults to now). */
  now?: Date;
}
