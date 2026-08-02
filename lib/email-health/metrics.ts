import { prisma } from '@/lib/prisma';
import type { DnsPosture, InboxHealthMetrics } from './types';

/**
 * Aggregation for the deliverability dashboard.
 *
 * Every function here issues a fixed number of grouped queries regardless of how
 * many inboxes are in scope — never one query per account. All counts come from
 * source rows (OutboundMessage / InboundMessage), not from the denormalised
 * EmailAccount.healthScore cache, so a stale cron run can never surface as
 * wrong numbers in the UI.
 */

export const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
export const WINDOW_7D_MS = 7 * WINDOW_24H_MS;

/** Statuses that mean the message actually left the building. A bounce was sent first. */
const DELIVERED_STATUSES = ['sent', 'bounced'] as const;

export interface InboxWindowCounts {
  sentCount: number;
  failedCount: number;
  hardBounceCount: number;
  softBounceCount: number;
  replyCount: number;
  spamSignalCount: number;
  trashSignalCount: number;
}

export function emptyWindowCounts(): InboxWindowCounts {
  return {
    sentCount: 0,
    failedCount: 0,
    hardBounceCount: 0,
    softBounceCount: 0,
    replyCount: 0,
    spamSignalCount: 0,
    trashSignalCount: 0,
  };
}

/** Domain an inbox sends from, or null for a malformed address. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Windowed outbound + inbound counts per inbox.
 *
 * Four grouped queries total:
 *   1. outbound by (accountId, status, bounceType)
 *   2. inbound replies by accountId
 *   3. inbound spam by accountId
 *   4. inbound trash by accountId
 */
export async function collectInboxCounts(
  accountIds: string[],
  windowStart: Date,
  windowEnd: Date
): Promise<Map<string, InboxWindowCounts>> {
  const byAccount = new Map<string, InboxWindowCounts>();
  for (const id of accountIds) byAccount.set(id, emptyWindowCounts());

  if (accountIds.length === 0) return byAccount;

  const ensure = (accountId: string): InboxWindowCounts => {
    let row = byAccount.get(accountId);
    if (!row) {
      row = emptyWindowCounts();
      byAccount.set(accountId, row);
    }
    return row;
  };

  // 1. Outbound. `sentAt` is the window axis — createdAt would count queued mail
  // that has not gone out yet.
  const outbound = await prisma.outboundMessage.groupBy({
    by: ['accountId', 'status', 'bounceType'],
    where: {
      accountId: { in: accountIds },
      sentAt: { gte: windowStart, lte: windowEnd },
    },
    _count: { _all: true },
  });

  for (const row of outbound) {
    const target = ensure(row.accountId);
    const n = row._count._all;

    if ((DELIVERED_STATUSES as readonly string[]).includes(row.status)) {
      target.sentCount += n;
    }
    if (row.status === 'failed') {
      target.failedCount += n;
    }
    if (row.status === 'bounced') {
      if (row.bounceType === 'soft') target.softBounceCount += n;
      // Anything bounced without an explicit soft classification is treated as
      // hard — the conservative reading for sender reputation.
      else target.hardBounceCount += n;
    }
  }

  // 2-4. Inbound signals. Separate grouped queries because Prisma groupBy cannot
  // express conditional counts in one pass.
  const inboundWindow = { accountId: { in: accountIds }, date: { gte: windowStart, lte: windowEnd } };

  const [replies, spam, trash] = await Promise.all([
    prisma.inboundMessage.groupBy({
      by: ['accountId'],
      where: { ...inboundWindow, isReply: true },
      _count: { _all: true },
    }),
    prisma.inboundMessage.groupBy({
      by: ['accountId'],
      where: { ...inboundWindow, isSpam: true },
      _count: { _all: true },
    }),
    prisma.inboundMessage.groupBy({
      by: ['accountId'],
      where: { ...inboundWindow, isTrash: true },
      _count: { _all: true },
    }),
  ]);

  for (const row of replies) ensure(row.accountId).replyCount += row._count._all;
  for (const row of spam) ensure(row.accountId).spamSignalCount += row._count._all;
  for (const row of trash) ensure(row.accountId).trashSignalCount += row._count._all;

  return byAccount;
}

/** Minimal shape of the EmailAccount fields the scorer needs. */
export interface ScorableAccount {
  id: string;
  email: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  dailyCap: number;
  dailySendCount: number;
  dailySendDate: Date | null;
  sendPausedAt: Date | null;
}

/**
 * Today's send count, corrected for day rollover.
 *
 * `dailySendCount` is a mutable counter the worker resets lazily on the next
 * send, so a stale date means the real count for today is zero.
 */
export function effectiveDailySendCount(account: ScorableAccount, now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!account.dailySendDate || account.dailySendDate < midnight) return 0;
  return account.dailySendCount;
}

/** Assembles the scorer input for one inbox. */
export function toHealthMetrics(
  account: ScorableAccount,
  counts: InboxWindowCounts,
  dnsStatus: DnsPosture,
  now: Date
): InboxHealthMetrics {
  return {
    isActive: account.isActive,
    isPaused: account.sendPausedAt !== null,
    lastSyncAt: account.lastSyncAt,
    sentCount: counts.sentCount,
    hardBounceCount: counts.hardBounceCount,
    softBounceCount: counts.softBounceCount,
    replyCount: counts.replyCount,
    // Spam and trash are both "recipient rejected this" signals.
    spamSignalCount: counts.spamSignalCount + counts.trashSignalCount,
    dailyCap: account.dailyCap,
    dailySendCount: effectiveDailySendCount(account, now),
    dnsStatus,
  };
}

/**
 * Suppression growth in the window.
 *
 * Deliberately tenant/campaign scoped rather than per-inbox: SuppressionEntry has
 * no accountId, and inventing a per-inbox number by matching lead assignment
 * would be a guess. An inbox's own contribution is its hardBounceCount.
 */
export async function collectSuppressionGrowth(
  windowStart: Date,
  windowEnd: Date
): Promise<{ total: number; byCampaign: Map<string, number> }> {
  const rows = await prisma.suppressionEntry.groupBy({
    by: ['campaignId'],
    where: { createdAt: { gte: windowStart, lte: windowEnd } },
    _count: { _all: true },
  });

  const byCampaign = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    total += row._count._all;
    if (row.campaignId) byCampaign.set(row.campaignId, row._count._all);
  }
  return { total, byCampaign };
}

/** Maps a stored EmailDomainHealth row to the coarse posture the scorer wants. */
export function dnsPostureFrom(
  domainRow: { spfStatus: string; dmarcStatus: string; mxStatus: string; dkimStatus: string } | null | undefined
): DnsPosture {
  if (!domainRow) return 'unknown';

  const checks = [domainRow.spfStatus, domainRow.dmarcStatus, domainRow.mxStatus];
  if (checks.some((s) => s === 'fail')) return 'failed';
  if (checks.every((s) => s === 'pass' || s === 'manual_verified')) return 'verified';
  return 'unknown';
}
