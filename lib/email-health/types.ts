/**
 * Shared types for the deliverability / email health module.
 *
 * Kept free of Prisma imports so the scoring layer stays a pure, dependency-light
 * unit that can be exercised without a database.
 */

export type EmailHealthLevelValue = 'healthy' | 'watch' | 'at_risk' | 'critical' | 'paused';

/** Every distinct reason a mailbox can lose points. */
export type HealthReasonCode =
  | 'mailbox_inactive'
  | 'send_paused'
  | 'stale_sync'
  | 'hard_bounce_critical'
  | 'hard_bounce_elevated'
  | 'soft_bounce_elevated'
  | 'spam_signals'
  | 'daily_cap_nearly_exhausted'
  | 'no_replies_at_volume'
  | 'dns_unverified';

/** DNS posture for the domain a mailbox sends from. */
export type DnsPosture = 'verified' | 'failed' | 'unknown';

/**
 * Everything the scorer needs about one mailbox. Counts are for the trailing
 * 7-day window unless the field name says otherwise; `daily*` reflect today.
 */
export interface InboxHealthMetrics {
  isActive: boolean;
  /** Manager-set pause (EmailAccount.sendPausedAt is non-null). */
  isPaused: boolean;
  lastSyncAt: Date | null;
  sentCount: number;
  hardBounceCount: number;
  softBounceCount: number;
  replyCount: number;
  /** Inbound messages flagged spam or trash by the provider. */
  spamSignalCount: number;
  dailyCap: number;
  dailySendCount: number;
  dnsStatus: DnsPosture;
}

export interface InboxHealthResult {
  score: number;
  level: EmailHealthLevelValue;
  /** Machine-readable causes, stable across wording changes. */
  reasonCodes: HealthReasonCode[];
  /** Human-readable causes, safe for internal UI. */
  reasons: string[];
  recommendedActions: string[];
  /** Derived rates, surfaced so callers do not recompute them. */
  rates: {
    hardBounceRate: number;
    softBounceRate: number;
    replyRate: number;
    spamSignalRate: number;
    dailyUsageRate: number;
  };
}
