import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import type { EmailSyncPayload, EmailApplyReplyPayload, EmailApplyBouncePayload } from '@/lib/bullmq/types';
import { EmailService } from '@/lib/email/EmailService';
import type { InboxMessage } from '@/lib/email/EmailService';
import { toInboxBatch } from '@/lib/email/inboxBatch';
import { isBounceMessage, isAutoReply, extractBouncedRecipient } from '@/lib/email/bounceDetection';
import { pauseAllLeadCadences } from '@/lib/sequences/leadStop';
import { suppressRecipient } from '@/lib/email/suppress';
import { classifyReply } from '@/lib/replies/classification';
import { applyReplyClassification } from '@/lib/replies/handling';

/** Stages a reply moves forward to "replied". Later stages (meeting booked, won, lost) stay put. */
const STAGES_A_REPLY_ADVANCES = ['new', 'sequence_active'] as const;

const SOFT_BOUNCE_RE = /temporarily|try again later|mailbox full|over quota|too large|try again/i;
const DEFAULT_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function classifyBounceType(subject: string): 'hard' | 'soft' {
  return SOFT_BOUNCE_RE.test(subject) ? 'soft' : 'hard';
}

type MatchedLead = {
  id: string;
  email: string;
  sequenceId: string | null;
  sequenceStatus: string | null;
  emailInvalid: boolean;
};

// How far back a reply or bounce is traced to the send it answers. Bounded so the lookup rides the
// (accountId, sentAt) index instead of scanning a busy sender mailbox's whole history.
const SENT_MATCH_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

const MATCHED_LEAD_SELECT = {
  id: true, email: true, sequenceId: true, sequenceStatus: true, emailInvalid: true,
} as const;

/**
 * The lead behind each address a fetched message came from (a reply) or bounced for.
 *
 * First the mailbox's own sends: an address this mailbox wrote to names its lead exactly, whoever
 * holds that lead. Then, for addresses it never wrote to, the mailbox owner's own leads.
 *
 * Only the second used to exist. Since sequences send only from their chosen sender mailboxes
 * (#250), a sequence regularly sends from a mailbox that is not the lead holder's, and every reply
 * and every bounce landing there matched no lead: the cadence kept sending to a prospect who had
 * answered, and to an address that had bounced (owner, 2026-10-07).
 */
async function matchLeads(
  account: { id: string; userId: string; tenantId: string },
  emails: string[],
  /** Addresses a bounce names; one still unmatched falls back to the tenant's latest send to it. */
  bouncedEmails: string[] = [],
): Promise<Map<string, MatchedLead>> {
  const byEmail = new Map<string, MatchedLead>();
  if (emails.length === 0) return byEmail;

  const sent = await prisma.outboundMessage.findMany({
    // Sends that left (sentAt set): an attempt that never went out cannot be what was answered.
    where: {
      accountId: account.id,
      sentAt: { gte: new Date(Date.now() - SENT_MATCH_WINDOW_MS) },
      to: { in: emails, mode: 'insensitive' },
    },
    select: { leadId: true, to: true },
    orderBy: { sentAt: 'desc' },
  });
  // The latest send to each address names the lead.
  const sentLeadByAddress = new Map<string, string>();
  for (const row of sent) {
    const address = row.to.toLowerCase();
    if (!sentLeadByAddress.has(address)) sentLeadByAddress.set(address, row.leadId);
  }

  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        ...(sentLeadByAddress.size > 0 ? [{ id: { in: [...new Set(sentLeadByAddress.values())] } }] : []),
        { email: { in: emails, mode: 'insensitive' }, assignedToId: account.userId },
      ],
    },
    select: MATCHED_LEAD_SELECT,
  });
  const byId = new Map(leads.map((lead) => [lead.id, lead]));

  for (const lead of leads) {
    byEmail.set(lead.email.toLowerCase(), lead);
  }
  for (const [address, leadId] of sentLeadByAddress) {
    const lead = byId.get(leadId);
    if (lead) byEmail.set(address, lead);
  }

  // A bounce that still names no lead: the address was written to, just not from this mailbox nor
  // to its owner's lead — a bounce delivered to another mailbox, a forwarded DSN. A dead address is
  // dead for every sender, so the tenant's latest send to it names the lead (owner, 2026-10-09).
  const unmatchedBounces = [...new Set(bouncedEmails.map((e) => e.toLowerCase()))].filter((e) => !byEmail.has(e));
  if (unmatchedBounces.length > 0) {
    const tenantSends = await prisma.outboundMessage.findMany({
      where: {
        tenantId: account.tenantId,
        sentAt: { gte: new Date(Date.now() - SENT_MATCH_WINDOW_MS) },
        to: { in: unmatchedBounces, mode: 'insensitive' },
      },
      select: { leadId: true, to: true },
      orderBy: { sentAt: 'desc' },
    });
    const leadByAddress = new Map<string, string>();
    for (const row of tenantSends) {
      const address = row.to.toLowerCase();
      if (!leadByAddress.has(address)) leadByAddress.set(address, row.leadId);
    }
    if (leadByAddress.size > 0) {
      const found = await prisma.lead.findMany({
        where: { id: { in: [...new Set(leadByAddress.values())] } },
        select: MATCHED_LEAD_SELECT,
      });
      const foundById = new Map(found.map((lead) => [lead.id, lead]));
      for (const [address, leadId] of leadByAddress) {
        const lead = foundById.get(leadId);
        if (lead) byEmail.set(address, lead);
      }
    }
  }
  return byEmail;
}

/**
 * Where a run that stopped at the read limit resumes: the newest received time it read, less a second
 * — providers compare by the second, and a message sharing that second must not be skipped; one read
 * twice is skipped by the stored-message check. Never before `since` (a run must make progress) and
 * never after `now`.
 */
export function cursorAfter(messages: InboxMessage[], since: Date, now: Date): Date {
  const newest = messages.reduce((latest, m) => {
    const at = (m.receivedAt ?? m.date).getTime();
    return Number.isFinite(at) && at > latest ? at : latest;
  }, since.getTime());
  return new Date(Math.min(Math.max(newest - 1000, since.getTime()), now.getTime()));
}

/**
 * One fetched message, classified once so persistence and the reply/bounce
 * handlers agree on what it is.
 *
 * `lead` resolves differently per kind: a reply is attributed by its sender,
 * a bounce by the recipient parsed out of the DSN body (the sender of a bounce
 * is the remote mailer-daemon, which never matches a lead).
 */
type ClassifiedMessage = {
  msg: InboxMessage;
  isBounce: boolean;
  bounceType: 'hard' | 'soft' | null;
  bouncedRecipient: string | null;
  isReply: boolean;
  /** Provider-flagged auto-responder. Not a sales reply, but still routed to the chokepoint. */
  isAutoReply: boolean;
  lead: MatchedLead | undefined;
};

/** Whether a message arrived after the lead's running cadence began (a re-read's reply guard). */
async function repliedDuringCurrentEnrollment(leadId: string, msg: InboxMessage): Promise<boolean> {
  const at = (msg.receivedAt ?? msg.date).getTime();
  if (!Number.isFinite(at)) return false;
  const running = await prisma.sequenceEnrollment.findFirst({
    where: { leadId, status: 'active' },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  return Boolean(running && running.startedAt.getTime() <= at);
}

/** An ISO time, or nothing for a missing or unparseable date (a sender's Date: header can be anything). */
const validIso = (at: Date | undefined | null) => (at && !Number.isNaN(at.getTime()) ? at.toISOString() : undefined);

/** Postgres text cannot hold NUL; a message containing one would be refused on every retry. */
const stripNul = (value: string) => value.replace(/\u0000/g, '');

async function handleEmailSync(payload: EmailSyncPayload) {
  const { accountId } = payload;

  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) return { skipped: true, reason: 'account_not_found' };
  if (!account.isActive) return { skipped: true, reason: 'account_inactive' };

  const now = new Date();
  const resync = payload.since ? new Date(payload.since) : null;
  if (resync && Number.isNaN(resync.getTime())) return { skipped: true, reason: 'invalid_since' };
  const since = resync ?? account.lastSyncAt ?? new Date(now.getTime() - DEFAULT_SYNC_LOOKBACK_MS);

  const service = await EmailService.fromAccount(account);
  const fetched = await service.fetchMessagesSince(since);
  if (fetched === null) {
    if (!resync) {
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: now },
      });
    }
    return { skipped: true, reason: 'adapter_does_not_support_sync' };
  }
  const { messages, truncated, overflow } = toInboxBatch(fetched);

  // Pre-parse bounce recipients so lead lookup covers BOTH senders (replies) and
  // DSN-reported recipients (bounces). Looking up only senders meant every bounce
  // failed to match a lead and was dropped.
  const preParsed = messages.map((msg) => {
    const bounce = isBounceMessage(msg);
    return {
      msg,
      isBounce: bounce,
      bouncedRecipient: bounce ? extractBouncedRecipient(msg) : null,
    };
  });

  const lookupEmails = Array.from(
    new Set(
      preParsed
        .flatMap((p) => (p.isBounce ? [p.bouncedRecipient] : [p.msg.fromEmail]))
        .filter((e): e is string => Boolean(e))
    )
  );

  const bouncedEmails = preParsed.flatMap((p) => (p.isBounce && p.bouncedRecipient ? [p.bouncedRecipient] : []));
  const leadByEmail = await matchLeads(account, lookupEmails, bouncedEmails);

  const classified: ClassifiedMessage[] = preParsed.map((p) => {
    const auto = !p.isBounce && isAutoReply(p.msg);
    const matchKey = p.isBounce ? p.bouncedRecipient : p.msg.fromEmail;
    const lead = matchKey ? leadByEmail.get(matchKey.toLowerCase()) : undefined;
    return {
      msg: p.msg,
      isBounce: p.isBounce,
      bounceType: p.isBounce ? classifyBounceType(p.msg.subject) : null,
      bouncedRecipient: p.bouncedRecipient,
      // A reply only counts when it comes from a known lead — otherwise ordinary
      // inbound mail would inflate the deliverability reply rate.
      isReply: !p.isBounce && !auto && Boolean(p.msg.fromEmail) && Boolean(lead),
      isAutoReply: auto,
      lead,
    };
  });

  // Persist prospect mail and every bounce. Bounces used to be discarded here, which made
  // historical bounce rate impossible to reconstruct. Mail from anyone who is not a lead —
  // newsletters, colleagues, personal mail — is not stored (owner, 2026-10-07: it filled the
  // unified inbox, and it is not the CRM's to keep). It stays in the mailbox itself.
  //
  // Only what this run stores — or a stored message it can now place with a lead — is acted on. A
  // run reads some messages twice (the cursor backs up a second; a re-read covers old mail), and
  // acting on a stored bounce again re-notified the rep and marked a later send bounced.
  let unsaved = 0;
  const toApply = new Set<string>();
  for (const c of classified) {
    if (!c.msg.fromEmail) continue;
    if (!c.isBounce && !c.lead) continue;

    try {
      const exists =
        (await prisma.inboundMessage.findUnique({
          where: { providerMessageId: c.msg.providerMessageId },
          select: { id: true, leadId: true },
        })) ??
        // The id an adapter used before (IMAP stored the bare UID, which collides across mailboxes).
        (c.msg.legacyProviderMessageId
          ? await prisma.inboundMessage.findFirst({
              where: { providerMessageId: c.msg.legacyProviderMessageId, accountId },
              select: { id: true, leadId: true },
            })
          : null);
      if (exists) {
        // Stored with no lead — a bounce or reply the matching of the time could not place. It can
        // now: attach it and act on it, once (the claim is conditional on the lead still being unset).
        if (!exists.leadId && c.lead) {
          const claimed = await prisma.inboundMessage.updateMany({
            where: { id: exists.id, leadId: null },
            data: { leadId: c.lead.id, isReply: c.isReply },
          });
          if (claimed.count === 1) toApply.add(c.msg.providerMessageId);
        }
        continue;
      }

      await prisma.inboundMessage.create({
        data: {
          accountId,
          leadId: c.lead?.id ?? null,
          fromEmail: c.msg.fromEmail,
          fromName: c.msg.fromName ? stripNul(c.msg.fromName) : null,
          to: c.msg.to || account.email,
          subject: stripNul(c.msg.subject ?? ''),
          body: stripNul(c.msg.body ?? ''),
          bodyHtml: stripNul(c.msg.bodyHtml ?? c.msg.body ?? ''),
          providerMessageId: c.msg.providerMessageId,
          date: c.msg.date,
          isSpam: c.msg.isSpam ?? false,
          isTrash: c.msg.isTrash ?? false,
          isBounce: c.isBounce,
          isReply: c.isReply,
          bounceType: c.bounceType,
          bouncedRecipient: c.bouncedRecipient,
          tenantId: account.tenantId,
        },
      });
      toApply.add(c.msg.providerMessageId);
    } catch (saveErr) {
      // Another sync of the same mailbox stored it between our check and our insert: fine.
      if (saveErr instanceof Prisma.PrismaClientKnownRequestError && saveErr.code === 'P2002') continue;
      // A request the database rejected for its content (a value too long, …) fails the same way
      // on every retry. Holding the cursor for it would stop this mailbox syncing for good, so it
      // is skipped, loudly. Only a failure that may pass next time (connection, timeout) holds it.
      if (saveErr instanceof Prisma.PrismaClientKnownRequestError && !saveErr.code.startsWith('P1')) {
        console.error(`[sync:handleEmailSync] Skipping message ${c.msg.providerMessageId}: rejected by the database (${saveErr.code})`, saveErr);
        continue;
      }
      unsaved += 1;
      console.error(`[sync:handleEmailSync] Failed to save message ${c.msg.providerMessageId}:`, saveErr);
    }
  }

  let replies = 0;
  let bounces = 0;
  let autoReplies = 0;

  for (const c of classified) {
    if (!c.isBounce || !c.lead) continue;
    if (!toApply.has(c.msg.providerMessageId)) continue;
    if (c.lead.emailInvalid) continue;

    await handleApplyBounce({
      providerMessageId: c.msg.providerMessageId,
      leadId: c.lead.id,
      accountId,
      bounceType: c.bounceType ?? 'hard',
      receivedAt: validIso(c.msg.receivedAt ?? c.msg.date),
    });
    bounces++;
  }

  for (const c of classified) {
    if (c.isBounce || !c.lead) continue;
    if (!toApply.has(c.msg.providerMessageId)) continue;
    // Auto-responders reach the same chokepoint as ordinary replies (Phase 8b). They are stored
    // with `isReply: false`, so reply-rate reporting is untouched, but they still have to pause a
    // cadence and record why — and routing them anywhere else would be the second inbound
    // listener the architecture forbids.
    if (!c.isReply && !c.isAutoReply) continue;
    // Sequence side effects only apply to leads with a sequenceId. The authoritative gate
    // inside handleApplyReply checks SequenceEnrollment.status === 'active' so a stale
    // Lead.sequenceStatus legacy cache value never drops a real reply (S3).
    if (!c.lead.sequenceId) continue;
    // A re-read of the past acts only on what still concerns today's cadence: a reply the lead sent
    // before their current enrollment started belongs to an earlier one, and an old out-of-office says
    // nothing about now.
    if (resync && (c.isAutoReply || !(await repliedDuringCurrentEnrollment(c.lead.id, c.msg)))) continue;

    await handleApplyReply({
      providerMessageId: c.msg.providerMessageId,
      leadId: c.lead.id,
      accountId,
      autoReply: c.isAutoReply,
    });
    if (c.isReply) replies++;
    else autoReplies++;
  }

  if (unsaved > 0) {
    // Do not move the cursor past messages that were not stored: the next fetch starts from
    // `lastSyncAt`, so advancing it lost those replies and bounces for good (pre-launch audit,
    // 2026-10-05). The retry re-fetches them; stored ones are skipped by the exists check and the
    // reply/bounce handlers de-duplicate on the provider message id. Failing the job makes it visible.
    throw new Error(`[sync] ${unsaved} of ${messages.length} message(s) could not be saved for account ${accountId}; will retry from ${since.toISOString()}`);
  }

  // A run that read everything moves the cursor to now. One that stopped at the read limit moves it
  // only to the last message it read, so the next run starts there instead of skipping the rest.
  const cursor = truncated ? cursorAfter(messages, since, now) : now;
  if (resync) {
    // A re-read of the past: the live cursor is not this run's to move.
    return { success: true, accountId, messagesProcessed: messages.length, replies, bounces, autoReplies, truncated, cursor, ...(overflow ? { overflow } : {}) };
  }
  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: cursor },
  });

  return { success: true, accountId, messagesProcessed: messages.length, replies, bounces, autoReplies, truncated };
}

/**
 * The single inbound chokepoint (Phase 8b).
 *
 * Every reply — a pricing question, an out-of-office auto-responder, an unsubscribe — arrives
 * here, is classified once, and diverges in `applyReplyClassification`. There is no second
 * listener and no second place a reply changes CRM state.
 *
 * ## What class B does *not* do
 *
 * An administrative reply is not a sales reply. It does not move the lead to `replied`, does not
 * increment `emailReplyCount`, does not attribute itself to the originating send and writes no
 * `email_replied` activity — so an inbox full of out-of-office responders cannot inflate reply
 * rate. It still pauses the cadence and still records what happened.
 */
export async function handleApplyReply(payload: EmailApplyReplyPayload) {
  const { providerMessageId, leadId, accountId } = payload;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, stage: true, tenantId: true, assignedToId: true, firstName: true, lastName: true, company: true },
  });
  if (!lead) return { skipped: true, reason: 'lead_not_found' };

  const inbound = await prisma.inboundMessage.findUnique({
    where: { providerMessageId },
    select: { id: true, subject: true, body: true, isReply: true, classifiedAt: true },
  });

  // Redelivery deduplication (S4): if this exact provider message was already classified, skip.
  if (inbound?.classifiedAt) {
    return { skipped: true, reason: 'already_processed' };
  }

  // The authoritative gate. This used to read `Lead.sequenceStatus`, the legacy compatibility
  // cache; a stale value there could drop a real reply before the handoff was ever reached.
  // Resolved once here and passed down — nothing further along re-interprets sequence state.
  const activeEnrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId, status: 'active' },
    select: { id: true, sequenceId: true },
  });
  if (!activeEnrollment) {
    return { skipped: true, reason: 'sequence_not_active' };
  }

  // Classification decides everything below it. It never throws and never guesses: with no
  // provider it returns class D and a human reads the reply.
  const classification = await classifyReply({
    subject: inbound?.subject ?? null,
    body: inbound?.body ?? null,
    // `isReply: false` on a message that reached this handler means sync recognised an
    // auto-responder and routed it here anyway (Phase 8b) rather than to a second listener.
    isAutoReply: payload.autoReply ?? (inbound ? !inbound.isReply : false),
    tenantId: lead.tenantId,
    leadId,
  });

  if (inbound) {
    await prisma.inboundMessage.update({
      where: { id: inbound.id },
      data: {
        replyClass: classification.replyClass,
        replyKind: classification.kind,
        replyConfidence: classification.confidence,
        classificationSource: classification.source,
        classifiedAt: new Date(),
      },
    });
  }

  const actorUserId = lead.assignedToId ?? accountId;
  const isSalesReply = classification.replyClass === 'C' || classification.replyClass === 'D';

  if (isSalesReply) {
    // Attribute the reply to the send that earned it, so reply rate is computable
    // per inbox. Picking the newest un-replied sent message keeps this idempotent.
    const originating = await prisma.outboundMessage.findFirst({
      where: { leadId, accountId, status: 'sent', repliedAt: null },
      orderBy: { sentAt: 'desc' },
      select: { id: true },
    });
    if (originating) {
      await prisma.outboundMessage.update({
        where: { id: originating.id },
        data: { repliedAt: new Date() },
      });
    }

    // A reply moves a lead forward to "replied", never back: a prospect answering a thread after
    // their meeting was booked, or after the deal was won or lost, must not drop them out of that
    // stage. The count still goes up either way.
    await prisma.lead.update({
      where: { id: leadId },
      data: { emailReplyCount: { increment: 1 } },
    });
    const advanced = await prisma.lead.updateMany({
      where: { id: leadId, stage: { in: [...STAGES_A_REPLY_ADVANCES] } },
      data: { stage: 'replied' },
    });

    // Two activities on purpose: `stage_changed` drives the pipeline views, while
    // `email_replied` is the channel-level signal that reporting aggregates on. The stage change
    // is recorded only when the stage changed — a second reply is not a second move to Replied.
    if (advanced.count > 0) {
      await prisma.activity.create({
        data: {
          userId: actorUserId,
          leadId,
          type: 'stage_changed',
          channel: 'email',
          description: `Reply received from ${lead.firstName} ${lead.lastName} — moved to Replied`,
          metadata: { from: lead.stage, to: 'replied', providerMessageId, auto: true },
        },
      });
    }

    await prisma.activity.create({
      data: {
        userId: actorUserId,
        leadId,
        type: 'email_replied',
        channel: 'email',
        description: `${lead.firstName} ${lead.lastName} replied by email`,
        metadata: {
          providerMessageId,
          accountId,
          outboundMessageId: originating?.id ?? null,
          replyClass: classification.replyClass,
          replyKind: classification.kind,
          auto: true,
        },
      },
    });
  }

  // Pause/stop the *exact* enrollment this reply was resolved against, never "the lead's current
  // sequence". If it was replaced between the read and this write the pause simply refuses —
  // pausing the replacement would stop a cadence the reply says nothing about. A refusal is not a
  // failed reply either: the prospect still engaged, so everything else continues regardless.
  const outcome = await applyReplyClassification({
    leadId,
    tenantId: lead.tenantId,
    enrollment: activeEnrollment,
    eventId: providerMessageId,
    actorUserId,
    classification,
    leadName: lead.company ?? `${lead.firstName} ${lead.lastName}`,
  });

  return {
    success: true,
    leadId,
    providerMessageId,
    // Same vocabulary the lead-scoped helper reported, so the handler's result shape is unchanged.
    pauseOutcome: outcome.cadence === 'no_enrollment' ? 'not_active' : outcome.cadence,
    handoffApplied: outcome.handedOff,
    replyClass: classification.replyClass,
    replyKind: classification.kind,
    classificationSource: classification.source,
    resumeAt: outcome.resumeAt ?? null,
  };
}

export async function handleApplyBounce(payload: EmailApplyBouncePayload) {
  const { providerMessageId, leadId, accountId, bounceType } = payload;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, email: true, firstName: true, lastName: true, company: true, sequenceId: true, assignedToId: true, tags: true, emailInvalid: true, tenantId: true },
  });
  if (!lead) return { skipped: true, reason: 'lead_not_found' };

  const isHard = bounceType === 'hard';

  // Mark the originating send before the already-invalid guard below: a second
  // send that also bounces still needs its own row flipped, and only messages
  // still in 'sent' are selected so re-running cannot double-count.
  // The send this bounce answers: the latest one before it arrived. Without the bound, a step sent
  // after the bounce but before the sync read it was the one marked bounced.
  const arrivedAt = payload.receivedAt ? new Date(payload.receivedAt) : null;
  const bounceTime = arrivedAt && !Number.isNaN(arrivedAt.getTime()) ? arrivedAt : null;
  const originating = await prisma.outboundMessage.findFirst({
    where: {
      accountId,
      to: { equals: lead.email, mode: 'insensitive' },
      status: 'sent',
      ...(bounceTime ? { sentAt: { lte: bounceTime } } : {}),
    },
    orderBy: { sentAt: 'desc' },
    select: { id: true },
  });
  if (originating) {
    await prisma.outboundMessage.update({
      where: { id: originating.id },
      data: { status: 'bounced', bouncedAt: bounceTime ?? new Date(), bounceType },
    });
  }

  // Providers redeliver, and this write sits before the already-invalid guard below, so a
  // redelivered webhook used to add a second timeline entry for one bounce. The prospect
  // bounced once; the record should say so once. Keyed on the provider's own event id, which
  // is what makes the two deliveries recognisable as the same event.
  const alreadyRecorded = await prisma.activity.findFirst({
    where: {
      tenantId: lead.tenantId,
      leadId,
      type: 'email_bounced',
      metadata: { path: ['providerMessageId'], equals: providerMessageId },
    },
    select: { id: true },
  });

  if (!alreadyRecorded) {
    await prisma.activity.create({
      data: {
        userId: lead.assignedToId ?? accountId,
        leadId,
        type: 'email_bounced',
        channel: 'email',
        description: `Email to ${lead.email} ${isHard ? 'hard' : 'soft'}-bounced`,
        metadata: { providerMessageId, accountId, bounceType, outboundMessageId: originating?.id ?? null, auto: true },
      },
    });
  }

  // Any bounce suppresses, hard or soft, with no second attempt — the operator's 2026-09-23
  // rule, taken after a mailbox's health score fell. A soft bounce used to be left in the pool
  // as "transient", which in practice meant the same full or disabled mailbox was written to
  // again on the next step, and the provider counted every one of those against us.
  //
  // Routed through `lib/email/suppress.ts` rather than writing the rows here, so this path and
  // the send path cannot drift. That helper also writes `campaignId: null`, where this code
  // left it unset — which is how a dead address stayed reachable by the next campaign.
  if (lead.email) {
    await suppressRecipient({
      tenantId: lead.tenantId,
      email: lead.email,
      leadId,
      reason: isHard ? 'hard_bounce' : 'soft_bounce',
      detail: `${isHard ? 'hard' : 'soft'} bounce reported by the provider`,
      actorUserId: lead.assignedToId ?? accountId,
      // The timeline entry above is keyed to the provider's message id, which is what makes a
      // redelivered webhook write one row instead of two. A second entry from here would double
      // the lead's history for a single bounce.
      recordActivity: false,
    });
  }

  // Every running cadence, not the first one found: with several sequences on a lead, pausing
  // one left the rest generating steps to an address the provider had just refused.
  await pauseAllLeadCadences({
    leadId,
    reason: isHard ? 'hard_bounce' : 'soft_bounce',
    actorUserId: lead.assignedToId ?? accountId,
  });

  await prisma.notification.create({
    data: {
      userId: lead.assignedToId ?? accountId,
      type: 'email_bounced',
      title: isHard ? 'Email Bounced (Hard)' : 'Email Bounced (Soft)',
      text: `Email to ${lead.firstName} ${lead.lastName} (${lead.email}) ${isHard ? 'hard-bounced' : 'soft-bounced'}. The address was ${isHard ? 'flagged invalid' : 'temporarily rejected'}${lead.sequenceId ? ' and the sequence was paused' : ''}.`,
      linkTo: `/leads/${leadId}`,
    },
  });

  return { success: true, leadId, bounceType, providerMessageId };
}

export { handleEmailSync, createSyncWorker };

function createSyncWorker() {
  return createAppWorker(
    'sync',
    async (job) => {
      if (job.name === JobType.EMAIL_SYNC) {
        return handleEmailSync(job.data as EmailSyncPayload);
      }
      if (job.name === JobType.EMAIL_APPLY_REPLY) {
        return handleApplyReply(job.data as EmailApplyReplyPayload);
      }
      if (job.name === JobType.EMAIL_APPLY_BOUNCE) {
        return handleApplyBounce(job.data as EmailApplyBouncePayload);
      }
    },
    { concurrency: 3 }
  );
}
