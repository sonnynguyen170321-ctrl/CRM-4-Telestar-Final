import type {
  DnsPosture,
  EmailHealthLevelValue,
  HealthReasonCode,
  InboxHealthMetrics,
  InboxHealthResult,
} from './types';
import { labelsFor, recommendationsFor } from './recommendations';

/**
 * Pure inbox health scoring. No I/O, no Prisma, no clock access except the `now`
 * argument — so every threshold below is directly unit-testable.
 *
 * Thresholds are module constants today. When per-tenant tuning arrives they can
 * be lifted into a config object without changing the shape of scoreInbox().
 */

const STARTING_SCORE = 100;

// --- Deductions ---
const PENALTY_MAILBOX_INACTIVE = 25;
const PENALTY_STALE_SYNC = 20;
const PENALTY_HARD_BOUNCE_CRITICAL = 20;
const PENALTY_HARD_BOUNCE_ELEVATED = 10;
const PENALTY_SOFT_BOUNCE_ELEVATED = 15;
const PENALTY_SPAM_SIGNALS = 10;
const PENALTY_DAILY_CAP_NEARLY_EXHAUSTED = 10;
const PENALTY_NO_REPLIES_AT_VOLUME = 10;
const PENALTY_DNS_UNVERIFIED = 20;

// --- Thresholds ---
const STALE_SYNC_MS = 24 * 60 * 60 * 1000;
const HARD_BOUNCE_CRITICAL_RATE = 0.05;
const HARD_BOUNCE_ELEVATED_RATE = 0.02;
const SOFT_BOUNCE_ELEVATED_RATE = 0.08;
const SPAM_SIGNAL_RATE = 0.01;
const DAILY_USAGE_HIGH_RATE = 0.9;
/** Below this many sends in the window, a zero reply rate is not yet meaningful. */
const MEANINGFUL_SEND_VOLUME = 20;

// --- Level cutoffs (inclusive lower bounds) ---
const LEVEL_HEALTHY_MIN = 90;
const LEVEL_WATCH_MIN = 75;
const LEVEL_AT_RISK_MIN = 50;

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

/**
 * Maps a numeric score to a level. Paused is a state, not a score band, so it is
 * decided by the caller before this runs.
 */
export function levelForScore(score: number): EmailHealthLevelValue {
  if (score >= LEVEL_HEALTHY_MIN) return 'healthy';
  if (score >= LEVEL_WATCH_MIN) return 'watch';
  if (score >= LEVEL_AT_RISK_MIN) return 'at_risk';
  return 'critical';
}

function isDnsRisky(status: DnsPosture): boolean {
  return status !== 'verified';
}

export function scoreInbox(metrics: InboxHealthMetrics, now: Date = new Date()): InboxHealthResult {
  const rates = {
    hardBounceRate: safeRate(metrics.hardBounceCount, metrics.sentCount),
    softBounceRate: safeRate(metrics.softBounceCount, metrics.sentCount),
    replyRate: safeRate(metrics.replyCount, metrics.sentCount),
    spamSignalRate: safeRate(metrics.spamSignalCount, metrics.sentCount),
    dailyUsageRate: safeRate(metrics.dailySendCount, metrics.dailyCap),
  };

  const reasonCodes: HealthReasonCode[] = [];
  let score = STARTING_SCORE;

  const deduct = (points: number, code: HealthReasonCode) => {
    score -= points;
    reasonCodes.push(code);
  };

  if (!metrics.isActive) {
    deduct(PENALTY_MAILBOX_INACTIVE, 'mailbox_inactive');
  }

  const lastSync = metrics.lastSyncAt;
  if (!lastSync || now.getTime() - lastSync.getTime() > STALE_SYNC_MS) {
    deduct(PENALTY_STALE_SYNC, 'stale_sync');
  }

  // Bounce bands are exclusive of each other — a critical rate must not also be
  // charged the elevated penalty.
  if (rates.hardBounceRate > HARD_BOUNCE_CRITICAL_RATE) {
    deduct(PENALTY_HARD_BOUNCE_CRITICAL, 'hard_bounce_critical');
  } else if (rates.hardBounceRate >= HARD_BOUNCE_ELEVATED_RATE) {
    deduct(PENALTY_HARD_BOUNCE_ELEVATED, 'hard_bounce_elevated');
  }

  if (rates.softBounceRate > SOFT_BOUNCE_ELEVATED_RATE) {
    deduct(PENALTY_SOFT_BOUNCE_ELEVATED, 'soft_bounce_elevated');
  }

  if (rates.spamSignalRate > SPAM_SIGNAL_RATE) {
    deduct(PENALTY_SPAM_SIGNALS, 'spam_signals');
  }

  if (rates.dailyUsageRate > DAILY_USAGE_HIGH_RATE) {
    deduct(PENALTY_DAILY_CAP_NEARLY_EXHAUSTED, 'daily_cap_nearly_exhausted');
  }

  // Only a signal once enough mail has gone out to expect a response.
  if (metrics.sentCount >= MEANINGFUL_SEND_VOLUME && metrics.replyCount === 0) {
    deduct(PENALTY_NO_REPLIES_AT_VOLUME, 'no_replies_at_volume');
  }

  // Unverified DNS only matters for a mailbox that is actually sending.
  if (isDnsRisky(metrics.dnsStatus) && metrics.sentCount > 0) {
    deduct(PENALTY_DNS_UNVERIFIED, 'dns_unverified');
  }

  const clampedScore = Math.max(0, Math.min(STARTING_SCORE, score));

  // A manual pause overrides the band: the mailbox is deliberately stopped, and
  // reporting it as "critical" would imply an automatic fault.
  if (metrics.isPaused) {
    const pausedReasons: HealthReasonCode[] = ['send_paused', ...reasonCodes];
    return {
      score: clampedScore,
      level: 'paused',
      reasonCodes: pausedReasons,
      reasons: labelsFor(pausedReasons),
      recommendedActions: recommendationsFor(pausedReasons),
      rates,
    };
  }

  return {
    score: clampedScore,
    level: levelForScore(clampedScore),
    reasonCodes,
    reasons: labelsFor(reasonCodes),
    recommendedActions: recommendationsFor(reasonCodes),
    rates,
  };
}

export const SCORING_THRESHOLDS = {
  STALE_SYNC_MS,
  HARD_BOUNCE_CRITICAL_RATE,
  HARD_BOUNCE_ELEVATED_RATE,
  SOFT_BOUNCE_ELEVATED_RATE,
  SPAM_SIGNAL_RATE,
  DAILY_USAGE_HIGH_RATE,
  MEANINGFUL_SEND_VOLUME,
  LEVEL_HEALTHY_MIN,
  LEVEL_WATCH_MIN,
  LEVEL_AT_RISK_MIN,
} as const;
