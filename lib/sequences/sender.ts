import type { EmailAccount } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * Which mailbox a sequence step sends from.
 *
 * Until 2026-10-03 the answer was `emailAccount.findFirst({ userId: lead owner, isActive })` — no
 * ordering, so an owner with two mailboxes sent from whichever Postgres returned, and a sequence
 * had no say at all. The owner asked to "add sending emails for a sequence campaign".
 *
 * The rule now:
 *
 *   1. **An enrollment keeps its mailbox.** Once an occurrence has sent from a mailbox, every later
 *      step uses it while it stays active: a prospect's thread must not change address halfway, or
 *      their reply lands in an inbox the cadence is not watching.
 *   2. **A sequence with senders picks among them** — the active one with the most of today's cap
 *      left — and fixes the choice on the enrollment with a compare-and-set, so two steps resolving
 *      at once agree on one mailbox.
 *   3. **A sequence never falls back to the rep's own mailbox** (owner, 2026-10-06: "it may be on
 *      another domain"). A sequence step sends only from the sequence's senders; with none chosen,
 *      or all disconnected, this returns null and `senderGap` says which, so the step waits.
 *      The owner's oldest mailbox remains only for a send with no sequence at all.
 *
 * Returns null when nothing can send; the eligibility decision downstream turns that into a hold
 * with a reason, so this never invents one.
 */

/** Local midnight, the same day boundary `atomicReserveQuota` (workers/email.ts) resets on. */
export function remainingToday(account: Pick<EmailAccount, 'dailyCap' | 'dailySendCount' | 'dailySendDate'>, now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sentToday = account.dailySendDate && account.dailySendDate >= midnight ? account.dailySendCount : 0;
  return account.dailyCap - sentToday;
}

/**
 * Whether a mailbox would actually send right now — the same conditions the eligibility decision
 * defers on. A paused mailbox sends nothing, so it always has the most of today's cap left; chosen
 * on that alone it collected every new lead while the working mailboxes beside it sat idle.
 */
export function canSendNow(
  account: Pick<EmailAccount, 'isActive' | 'sendPausedAt' | 'healthLevel' | 'dailyCap' | 'dailySendCount' | 'dailySendDate'>,
  now: Date,
): boolean {
  if (!account.isActive || account.sendPausedAt) return false;
  if (account.healthLevel === 'critical' && process.env.EMAIL_HEALTH_AUTOPAUSE === 'true') return false;
  return account.dailyCap <= 0 || remainingToday(account, now) > 0;
}

export type SenderState = 'sending' | 'at_limit' | 'paused' | 'held' | 'disconnected';

/** What a mailbox is doing right now, in the order the reasons would stop a send. */
export function senderState(
  account: Pick<EmailAccount, 'isActive' | 'sendPausedAt' | 'healthLevel' | 'dailyCap' | 'dailySendCount' | 'dailySendDate'>,
  now: Date,
): SenderState {
  if (!account.isActive) return 'disconnected';
  if (account.sendPausedAt) return 'paused';
  if (account.healthLevel === 'critical' && process.env.EMAIL_HEALTH_AUTOPAUSE === 'true') return 'held';
  if (account.dailyCap > 0 && remainingToday(account, now) <= 0) return 'at_limit';
  return 'sending';
}

export async function resolveSendingMailbox(input: {
  tenantId: string;
  enrollmentId: string | null;
  sequenceId: string | null;
  ownerUserId: string | null;
  now?: Date;
}): Promise<EmailAccount | null> {
  const now = input.now ?? new Date();

  const enrollment = input.enrollmentId
    ? await prisma.sequenceEnrollment.findFirst({
        where: { id: input.enrollmentId, tenantId: input.tenantId },
        select: { senderAccountId: true },
      })
    : null;

  // 1. Already fixed for this occurrence — while it is still one of the sequence's senders. A mailbox
  // removed from the sequence must not keep sending its cadences.
  if (enrollment?.senderAccountId) {
    const fixed = await prisma.emailAccount.findFirst({
      where: {
        id: enrollment.senderAccountId,
        tenantId: input.tenantId,
        isActive: true,
        ...(input.sequenceId ? { sequenceSenders: { some: { sequenceId: input.sequenceId } } } : {}),
      },
    });
    if (fixed) return fixed;
    // The fixed mailbox was disconnected. Fall through and choose again rather than stall the
    // cadence; the new choice is recorded the same way below.
  }

  // 2. The sequence's own senders.
  if (input.sequenceId) {
    const senders = await prisma.sequenceSender.findMany({
      where: { tenantId: input.tenantId, sequenceId: input.sequenceId, emailAccount: { isActive: true } },
      include: { emailAccount: true },
      orderBy: { createdAt: 'asc' },
    });
    if (senders.length > 0) {
      // Among the mailboxes that can send now; if none can, the fullest choice still stands so the
      // step defers with that mailbox's reason instead of quietly changing sender.
      const accounts = senders.map((sender) => sender.emailAccount);
      const sendable = accounts.filter((account) => canSendNow(account, now));
      const chosen = (sendable.length > 0 ? sendable : accounts)
        .sort((a, b) => remainingToday(b, now) - remainingToday(a, now) || a.createdAt.getTime() - b.createdAt.getTime())[0];

      if (input.enrollmentId) {
        // Compare-and-set: only set it if no other step fixed one in the meantime (or the fixed one
        // is the disconnected mailbox being replaced). Whoever lost reads the winner's choice.
        const claimed = await prisma.sequenceEnrollment.updateMany({
          where: {
            id: input.enrollmentId,
            tenantId: input.tenantId,
            OR: [{ senderAccountId: null }, { senderAccountId: enrollment?.senderAccountId ?? '__none__' }],
          },
          data: { senderAccountId: chosen.id },
        });
        if (claimed.count === 0) {
          const winner = await prisma.sequenceEnrollment.findFirst({
            where: { id: input.enrollmentId, tenantId: input.tenantId },
            select: { senderAccountId: true },
          });
          const won = winner?.senderAccountId
            ? senders.find((sender) => sender.emailAccountId === winner.senderAccountId)?.emailAccount
            : null;
          if (won) return won;
        }
      }
      return chosen;
    }
  }

  // 3. Never the rep's mailbox for a sequence step: the sequence chose its senders, or it sends nothing.
  if (input.sequenceId) return null;

  // A send with no sequence: the owner's oldest active mailbox.
  if (!input.ownerUserId) return null;
  return prisma.emailAccount.findFirst({
    where: { tenantId: input.tenantId, userId: input.ownerUserId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Why a sequence has no mailbox to send from: it chose none, or every mailbox it chose is
 * disconnected. Null when it has a usable one. Read only after `resolveSendingMailbox` returned null.
 */
export async function sequenceSenderGap(
  tenantId: string,
  sequenceId: string,
): Promise<'none_chosen' | 'all_disconnected' | null> {
  const senders = await prisma.sequenceSender.findMany({
    where: { tenantId, sequenceId },
    select: { emailAccount: { select: { isActive: true } } },
  });
  if (senders.length === 0) return 'none_chosen';
  return senders.some((sender) => sender.emailAccount.isActive) ? null : 'all_disconnected';
}
