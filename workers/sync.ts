import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import type { EmailSyncPayload, EmailApplyReplyPayload, EmailApplyBouncePayload } from '@/lib/bullmq/types';
import { EmailService } from '@/lib/email/EmailService';
import type { InboxMessage } from '@/lib/email/EmailService';
import { isBounceMessage, isAutoReply, extractBouncedRecipient } from '@/lib/email/bounceDetection';
import { pauseEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { classifyReply } from '@/lib/replies/classification';
import { applyReplyClassification } from '@/lib/replies/handling';

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

async function handleEmailSync(payload: EmailSyncPayload) {
  const { accountId } = payload;

  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) return { skipped: true, reason: 'account_not_found' };
  if (!account.isActive) return { skipped: true, reason: 'account_inactive' };

  const now = new Date();
  const since = account.lastSyncAt ?? new Date(now.getTime() - DEFAULT_SYNC_LOOKBACK_MS);

  const service = await EmailService.fromAccount(account);
  const messages = await service.fetchMessagesSince(since);
  if (messages === null) {
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: now },
    });
    return { skipped: true, reason: 'adapter_does_not_support_sync' };
  }

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

  const leadByEmail = new Map<string, MatchedLead>();
  if (lookupEmails.length > 0) {
    const existingLeads = await prisma.lead.findMany({
      where: {
        email: { in: lookupEmails, mode: 'insensitive' },
        assignedToId: account.userId,
      },
      select: { id: true, email: true, sequenceId: true, sequenceStatus: true, emailInvalid: true },
    });
    for (const l of existingLeads) {
      leadByEmail.set(l.email.toLowerCase(), l);
    }
  }

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

  // Persist every message, bounces included. Bounces used to be discarded here,
  // which made historical bounce rate impossible to reconstruct.
  for (const c of classified) {
    if (!c.msg.fromEmail) continue;

    try {
      const exists = await prisma.inboundMessage.findUnique({
        where: { providerMessageId: c.msg.providerMessageId },
        select: { id: true },
      });
      if (exists) continue;

      await prisma.inboundMessage.create({
        data: {
          accountId,
          leadId: c.lead?.id ?? null,
          fromEmail: c.msg.fromEmail,
          fromName: c.msg.fromName ?? null,
          to: c.msg.to || account.email,
          subject: c.msg.subject,
          body: c.msg.body ?? '',
          bodyHtml: c.msg.bodyHtml ?? c.msg.body ?? '',
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
    } catch (saveErr) {
      console.error(`[sync:handleEmailSync] Failed to save message ${c.msg.providerMessageId}:`, saveErr);
    }
  }

  let replies = 0;
  let bounces = 0;
  let autoReplies = 0;

  for (const c of classified) {
    if (!c.isBounce || !c.lead) continue;
    if (c.lead.emailInvalid) continue;

    await handleApplyBounce({
      providerMessageId: c.msg.providerMessageId,
      leadId: c.lead.id,
      accountId,
      bounceType: c.bounceType ?? 'hard',
    });
    bounces++;
  }

  for (const c of classified) {
    if (c.isBounce || !c.lead) continue;
    // Auto-responders reach the same chokepoint as ordinary replies (Phase 8b). They are stored
    // with `isReply: false`, so reply-rate reporting is untouched, but they still have to pause a
    // cadence and record why — and routing them anywhere else would be the second inbound
    // listener the architecture forbids.
    if (!c.isReply && !c.isAutoReply) continue;
    // Sequence side effects only apply to leads with a sequenceId. The authoritative gate
    // inside handleApplyReply checks SequenceEnrollment.status === 'active' so a stale
    // Lead.sequenceStatus legacy cache value never drops a real reply (S3).
    if (!c.lead.sequenceId) continue;

    await handleApplyReply({
      providerMessageId: c.msg.providerMessageId,
      leadId: c.lead.id,
      accountId,
      autoReply: c.isAutoReply,
    });
    if (c.isReply) replies++;
    else autoReplies++;
  }

  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: now },
  });

  return { success: true, accountId, messagesProcessed: messages.length, replies, bounces, autoReplies };
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

    await prisma.lead.update({
      where: { id: leadId },
      data: { stage: 'replied', emailReplyCount: { increment: 1 } },
    });

    // Two activities on purpose: `stage_changed` drives the pipeline views, while
    // `email_replied` is the channel-level signal that reporting aggregates on.
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
  const originating = await prisma.outboundMessage.findFirst({
    where: { accountId, to: { equals: lead.email, mode: 'insensitive' }, status: 'sent' },
    orderBy: { sentAt: 'desc' },
    select: { id: true },
  });
  if (originating) {
    await prisma.outboundMessage.update({
      where: { id: originating.id },
      data: { status: 'bounced', bouncedAt: new Date(), bounceType },
    });
  }

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

  // Hard bounces make the email permanently invalid; soft bounces are transient
  if (isHard) {
    if (lead.emailInvalid) return { skipped: true, reason: 'already_invalid' };

    const tags = lead.tags as string[] | undefined;
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        emailInvalid: true,
        tags: tags?.includes('invalid-email') ? undefined : { push: 'invalid-email' },
      },
    });

    const existingSuppression = await prisma.suppressionEntry.findFirst({
      where: { tenantId: lead.tenantId, email: lead.email, reason: 'hard_bounce' },
    });
    if (!existingSuppression) {
      await prisma.suppressionEntry.create({
        data: {
          email: lead.email,
          reason: 'hard_bounce',
          tenantId: lead.tenantId,
        },
      });
    }
  }

  if (lead.sequenceId) {
    const bounced = await prisma.sequenceEnrollment.findFirst({
      where: { leadId, status: 'active' },
      select: { id: true, sequenceId: true },
    });
    if (bounced) {
      await pauseEnrollmentOccurrence({
        enrollmentId: bounced.id,
        leadId,
        sequenceId: bounced.sequenceId,
        reason: isHard ? 'hard_bounce' : 'soft_bounce',
        actorUserId: lead.assignedToId ?? accountId,
      });
    }
  }

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
