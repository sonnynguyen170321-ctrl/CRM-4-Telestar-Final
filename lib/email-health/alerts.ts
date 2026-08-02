import { prisma } from '@/lib/prisma';
import type { EmailHealthAlertSeverity } from '@prisma/client';
import type { HealthReasonCode, InboxHealthResult } from './types';
import { REASON_LABEL, RECOMMENDED_ACTION } from './recommendations';

/**
 * Alert creation with de-duplication.
 *
 * The cron runs hourly. Without the open-alert check below, a single sustained
 * problem would produce 24 identical alerts a day and make the panel useless.
 * An alert is (re)raised only when there is no open alert of the same type for
 * the same inbox, or when severity has materially worsened.
 */

/** Reason codes that are worth interrupting a manager for. */
const ALERTABLE_REASONS: ReadonlySet<HealthReasonCode> = new Set([
  'mailbox_inactive',
  'stale_sync',
  'hard_bounce_critical',
  'hard_bounce_elevated',
  'soft_bounce_elevated',
  'spam_signals',
  'daily_cap_nearly_exhausted',
  'dns_unverified',
]);

const SEVERITY_BY_REASON: Record<HealthReasonCode, EmailHealthAlertSeverity> = {
  mailbox_inactive: 'critical',
  send_paused: 'info',
  stale_sync: 'warning',
  hard_bounce_critical: 'critical',
  hard_bounce_elevated: 'warning',
  soft_bounce_elevated: 'warning',
  spam_signals: 'critical',
  daily_cap_nearly_exhausted: 'info',
  no_replies_at_volume: 'info',
  dns_unverified: 'warning',
};

const SEVERITY_RANK: Record<EmailHealthAlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export interface SyncAlertsParams {
  accountId: string;
  accountEmail: string;
  tenantId: string;
  domain: string | null;
  result: InboxHealthResult;
}

export interface SyncAlertsOutcome {
  created: number;
  escalated: number;
  resolved: number;
}

/**
 * Reconciles open alerts for one inbox against its current health.
 *
 * Raises what is newly wrong, escalates what got worse, and auto-resolves alerts
 * whose underlying condition has cleared — so a fixed mailbox does not leave
 * stale red rows behind.
 */
export async function syncAccountAlerts(params: SyncAlertsParams): Promise<SyncAlertsOutcome> {
  const { accountId, accountEmail, tenantId, domain, result } = params;

  const activeReasons = result.reasonCodes.filter((code) => ALERTABLE_REASONS.has(code));
  const activeSet = new Set<string>(activeReasons);

  const openAlerts = await prisma.emailHealthAlert.findMany({
    where: { accountId, status: 'open' },
    select: { id: true, type: true, severity: true },
  });
  const openByType = new Map(openAlerts.map((a) => [a.type, a]));

  let created = 0;
  let escalated = 0;
  let resolved = 0;

  for (const code of activeReasons) {
    const severity = SEVERITY_BY_REASON[code];
    const existing = openByType.get(code);

    if (!existing) {
      await prisma.emailHealthAlert.create({
        data: {
          accountId,
          domain,
          type: code,
          title: REASON_LABEL[code],
          message: `${accountEmail}: ${REASON_LABEL[code]}`,
          severity,
          status: 'open',
          recommendedAction: RECOMMENDED_ACTION[code],
          tenantId,
        },
      });
      created++;
      continue;
    }

    // Same problem, but worse than when it was first raised.
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) {
      await prisma.emailHealthAlert.update({
        where: { id: existing.id },
        data: { severity, recommendedAction: RECOMMENDED_ACTION[code] },
      });
      escalated++;
    }
  }

  // Auto-resolve anything that is no longer true.
  const stale = openAlerts.filter((a) => !activeSet.has(a.type));
  if (stale.length > 0) {
    await prisma.emailHealthAlert.updateMany({
      where: { id: { in: stale.map((a) => a.id) } },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    resolved = stale.length;
  }

  return { created, escalated, resolved };
}
