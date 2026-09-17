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
import { checkDomainDns, type DomainDnsResult } from './domains';

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
 * How long a DNS verdict stays good for. An hourly health pass must not become an hourly
 * resolver query, and SPF/DMARC/MX records do not change by the hour.
 */
export const DNS_RECHECK_MS = 24 * 60 * 60_000;

/** True when a domain has never been checked, or its last check has gone stale. */
export function shouldRefreshDns(lastCheckedAt: Date | null | undefined, now: Date): boolean {
  if (!lastCheckedAt) return true;
  return now.getTime() - lastCheckedAt.getTime() > DNS_RECHECK_MS;
}

/**
 * Run the DNS check for one domain and shape the result for the `EmailDomainHealth` row.
 *
 * Returns `null` when the check itself could not be completed. An unreachable resolver is not
 * evidence that a domain is misconfigured, and writing `fail` on our own outage is the same
 * mistake as scoring an unrun check as risky — it turns our problem into theirs.
 *
 * The checker is a parameter so the hourly pass can be tested without DNS I/O.
 */
export async function refreshDomainDns(
  domain: string,
  check: (domain: string) => Promise<DomainDnsResult>
): Promise<{
  spfStatus: DomainDnsResult['spfStatus'];
  dmarcStatus: DomainDnsResult['dmarcStatus'];
  mxStatus: DomainDnsResult['mxStatus'];
  dnsNotes: string;
  lastCheckedAt: Date;
} | null> {
  try {
    const result = await check(domain);
    return {
      spfStatus: result.spfStatus,
      dmarcStatus: result.dmarcStatus,
      mxStatus: result.mxStatus,
      dnsNotes: result.notes.join('; '),
      lastCheckedAt: result.checkedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Scores every active inbox for one tenant.
 *
 * Must be called inside a tenantStorage.run for the tenant in question — writes
 * rely on the Prisma extension stamping tenantId.
 */
export async function runHealthPassForTenant(
  tenantId: string,
  now: Date = new Date(),
  // Injected so the pass can be exercised without DNS I/O; production takes the real resolver.
  checkDns: (domain: string) => Promise<DomainDnsResult> = checkDomainDns
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
  let domainRows = await prisma.emailDomainHealth.findMany({
    where: { domain: { in: domains } },
  });

  // Verify the domains whose verdict is missing or stale, before the posture is read below, so a
  // freshly checked domain is scored on this pass rather than the next one.
  //
  // Nothing did this. `checkDomainDns` was reachable only from a route a human had to press, so
  // every domain sat at `unknown` indefinitely — and until the scorer was corrected alongside this,
  // every sending mailbox on such a domain carried a penalty for a check nobody had run.
  type DnsFields = NonNullable<Awaited<ReturnType<typeof refreshDomainDns>>>;
  const refreshed = new Map<string, DnsFields>();
  for (const domain of domains) {
    const row = domainRows.find((d) => d.domain === domain);
    if (!shouldRefreshDns(row?.lastCheckedAt ?? null, now)) continue;
    const dns = await refreshDomainDns(domain, checkDns);
    if (dns) refreshed.set(domain, dns);
  }

  if (refreshed.size > 0) {
    for (const [domain, dns] of refreshed) {
      await prisma.emailDomainHealth.upsert({
        where: { tenantId_domain: { tenantId, domain } },
        create: { domain, tenantId, ...dns },
        update: dns,
      });
    }
    domainRows = await prisma.emailDomainHealth.findMany({
      where: { domain: { in: domains } },
    });
  }
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
