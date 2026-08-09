/**
 * Automation Engine shared type definitions (Phase 4).
 */

export type EligibilityDecision =
  | 'ALLOW'
  | 'BLOCK'
  | 'DEFER'
  | 'TERMINATE'
  | 'MANUAL_REQUIRED';

export type PausedReason =
  | 'reply'
  | 'hard_bounce'
  | 'soft_bounce'
  | 'meeting_booked'
  | 'manual'
  | 'email_health'
  | 'campaign_paused'
  | 'mailbox_unavailable';

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
