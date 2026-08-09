import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { JobType } from '@/lib/bullmq/types';
import type { EmailSyncPayload, EmailApplyReplyPayload, EmailApplyBouncePayload } from '@/lib/bullmq/types';
import { EmailService } from '@/lib/email/EmailService';
import type { InboxMessage } from '@/lib/email/EmailService';
import { isBounceMessage, isAutoReply, extractBouncedRecipient } from '@/lib/email/bounceDetection';
import { pauseSequence } from '@/lib/sequences/engine';

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
    if (!c.isReply || !c.lead) continue;
    // Sequence side effects only apply to leads mid-sequence. The reply itself is
    // already recorded on InboundMessage above, so metrics see it either way.
    if (!c.lead.sequenceId || c.lead.sequenceStatus !== 'active') continue;

    await handleApplyReply({
      providerMessageId: c.msg.providerMessageId,
      leadId: c.lead.id,
      accountId,
    });
    replies++;
  }

  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: now },
  });

  return { success: true, accountId, messagesProcessed: messages.length, replies, bounces };
}

export async function handleApplyReply(payload: EmailApplyReplyPayload) {
  const { providerMessageId, leadId, accountId } = payload;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, stage: true, sequenceStatus: true, assignedToId: true, firstName: true, lastName: true, company: true },
  });
  if (!lead) return { skipped: true, reason: 'lead_not_found' };
  if (lead.stage === 'replied') return { skipped: true, reason: 'already_replied' };
  if (lead.sequenceStatus === 'paused' || lead.sequenceStatus === null) {
    return { skipped: true, reason: 'sequence_not_active' };
  }

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

  await pauseSequence(leadId, 'reply', lead.assignedToId ?? accountId);

  // Two activities on purpose: `stage_changed` drives the pipeline views, while
  // `email_replied` is the channel-level signal that reporting aggregates on.
  await prisma.activity.create({
    data: {
      userId: lead.assignedToId ?? accountId,
      leadId,
      type: 'stage_changed',
      channel: 'email',
      description: `Reply received from ${lead.firstName} ${lead.lastName} — moved to Replied`,
      metadata: { from: lead.stage, to: 'replied', providerMessageId, auto: true },
    },
  });

  await prisma.activity.create({
    data: {
      userId: lead.assignedToId ?? accountId,
      leadId,
      type: 'email_replied',
      channel: 'email',
      description: `${lead.firstName} ${lead.lastName} replied by email`,
      metadata: { providerMessageId, accountId, outboundMessageId: originating?.id ?? null, auto: true },
    },
  });

  await prisma.task.create({
    data: {
      leadId,
      userId: lead.assignedToId ?? accountId,
      type: 'manual',
      title: `Handle reply from ${lead.firstName} ${lead.lastName}`,
      description: `Replied to your outreach email. Respond while it's warm.`,
      dueDate: new Date(),
      priority: 'high',
    },
  });

  await prisma.notification.create({
    data: {
      userId: lead.assignedToId ?? accountId,
      type: 'lead_replied',
      title: 'Lead Replied!',
      text: `${lead.firstName} ${lead.lastName} (${lead.company}) replied to your email. Sequence paused — handle the reply.`,
      linkTo: `/leads/${leadId}`,
    },
  });

  return { success: true, leadId, providerMessageId };
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
    await pauseSequence(leadId, isHard ? 'hard_bounce' : 'soft_bounce', lead.assignedToId ?? accountId);
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
