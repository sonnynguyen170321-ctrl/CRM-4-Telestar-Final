import { prisma } from '@/lib/prisma';
import type { EmailHealthLevel } from '@prisma/client';
import { scoreInbox } from './scoring';
import { syncAccountAlerts } from './alerts';
import {
  WINDOW_7D_MS,
  collectInboxCounts,
  domainOf,
  dnsPostureFrom,
  toHealthMetrics,
  type ScorableAccount,
} from './metrics';

/**
 * The hourly health pass: score every active inbox, cache the result on
 * EmailAccount, write a history snapshot, refresh domain rollups and reconcile
 * alerts.
 *
 * Snapshots are history only. Live views recompute from source rows, so a failed
 * or delayed run degrades trend charts but never makes the dashboard lie.
 */

export interface RunHealthPassResult {
  accountsScored: number;
  snapshotsWritten: number;
  alertsCreated: number;
  alertsEscalated: number;
  alertsResolved: number;
  domainsUpdated: number;
}

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  userId: true,
  isActive: true,
  lastSyncAt: true,
  dailyCap: true,
  dailySendCount: true,
  dailySendDate: true,
  sendPausedAt: true,
} as const;

/**
 * Scores every active inbox for one tenant.
 *
 * Must be called inside a tenantStorage.run for the tenant in question — writes
 * rely on the Prisma extension stamping tenantId.
 */
export async function runHealthPassForTenant(
  tenantId: string,
  now: Date = new Date()
): Promise<RunHealthPassResult> {
  const accounts = await prisma.emailAccount.findMany({
    where: { isActive: true },
    select: ACCOUNT_SELECT,
  });

  const outcome: RunHealthPassResult = {
    accountsScored: 0,
    snapshotsWritten: 0,
    alertsCreated: 0,
    alertsEscalated: 0,
    alertsResolved: 0,
    domainsUpdated: 0,
  };

  if (accounts.length === 0) return outcome;

  const windowEnd = now;
  const windowStart = new Date(now.getTime() - WINDOW_7D_MS);
  const accountIds = accounts.map((a) => a.id);

  // One grouped pass for all inboxes, not one query per inbox.
  const countsByAccount = await collectInboxCounts(accountIds, windowStart, windowEnd);

  // Domain posture, loaded once and shared by every inbox on that domain.
  const domains = Array.from(
    new Set(accounts.map((a) => domainOf(a.email)).filter((d): d is string => Boolean(d)))
  );
  const domainRows = await prisma.emailDomainHealth.findMany({
    where: { domain: { in: domains } },
  });
  const domainByName = new Map(domainRows.map((d) => [d.domain, d]));

  // Per-domain accumulators for the rollup written at the end.
  const domainTotals = new Map<string, { inboxes: number; sent: number; bounces: number; replies: number }>();

  for (const account of accounts) {
    const counts = countsByAccount.get(account.id) ?? {
      sentCount: 0, failedCount: 0, hardBounceCount: 0, softBounceCount: 0,
      replyCount: 0, spamSignalCount: 0, trashSignalCount: 0,
    };
    const domain = domainOf(account.email);
    const dnsStatus = dnsPostureFrom(domainByName.get(domain ?? ''));

    const metrics = toHealthMetrics(account as ScorableAccount, counts, dnsStatus, now);
    const result = scoreInbox(metrics, now);
    outcome.accountsScored++;

    await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        healthScore: result.score,
        healthLevel: result.level as EmailHealthLevel,
        lastHealthCheckAt: now,
      },
    });

    await prisma.emailHealthSnapshot.create({
      data: {
        accountId: account.id,
        userId: account.userId,
        domain,
        windowStart,
        windowEnd,
        sentCount: counts.sentCount,
        failedCount: counts.failedCount,
        hardBounceCount: counts.hardBounceCount,
        softBounceCount: counts.softBounceCount,
        replyCount: counts.replyCount,
        spamSignalCount: counts.spamSignalCount,
        trashSignalCount: counts.trashSignalCount,
        dailyCap: account.dailyCap,
        dailySendCount: metrics.dailySendCount,
        lastSyncAt: account.lastSyncAt,
        healthScore: result.score,
        healthLevel: result.level as EmailHealthLevel,
        reasons: result.reasons,
        recommendations: result.recommendedActions,
        tenantId,
      },
    });
    outcome.snapshotsWritten++;

    const alertOutcome = await syncAccountAlerts({
      accountId: account.id,
      accountEmail: account.email,
      tenantId,
      domain,
      result,
    });
    outcome.alertsCreated += alertOutcome.created;
    outcome.alertsEscalated += alertOutcome.escalated;
    outcome.alertsResolved += alertOutcome.resolved;

    if (domain) {
      const totals = domainTotals.get(domain) ?? { inboxes: 0, sent: 0, bounces: 0, replies: 0 };
      totals.inboxes++;
      totals.sent += counts.sentCount;
      totals.bounces += counts.hardBounceCount + counts.softBounceCount;
      totals.replies += counts.replyCount;
      domainTotals.set(domain, totals);
    }
  }

  for (const [domain, totals] of domainTotals) {
    const bounceRate = totals.sent > 0 ? totals.bounces / totals.sent : 0;
    const replyRate = totals.sent > 0 ? totals.replies / totals.sent : 0;

    await prisma.emailDomainHealth.upsert({
      where: { tenantId_domain: { tenantId, domain } },
      create: {
        domain,
        tenantId,
        activeInboxCount: totals.inboxes,
        sevenDaySent: totals.sent,
        sevenDayBounceRate: bounceRate,
        sevenDayReplyRate: replyRate,
      },
      update: {
        activeInboxCount: totals.inboxes,
        sevenDaySent: totals.sent,
        sevenDayBounceRate: bounceRate,
        sevenDayReplyRate: replyRate,
      },
    });
    outcome.domainsUpdated++;
  }

  return outcome;
}
