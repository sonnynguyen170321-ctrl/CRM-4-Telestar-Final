import { prisma } from '@/lib/prisma';

import { replySubject, stripReplyPrefix } from './threadingRules';

/**
 * Which earlier email a sequence step continues, and what that does to its subject.
 *
 * "Same thread" needs three things to be true of the previous email: it was sent, it came from
 * the mailbox sending now (a reply from another address is a different conversation), and the
 * provider told us its Message-ID. When any is missing the step still goes out — as a new email
 * that keeps the earlier subject, so the prospect sees one continuous subject line rather than a
 * "Re:" that replies to nothing.
 */

export type ThreadPlan =
  /** Send as a reply: this subject, and the parent the email worker builds the headers from. */
  | { mode: 'reply'; subject: string; inReplyToOutboundId: string }
  /** Could not thread; continue under the earlier subject. */
  | { mode: 'continue'; subject: string; reason: 'different_mailbox' | 'no_message_id' }
  /** Nothing earlier to continue: the step's own subject stands. */
  | { mode: 'new'; reason: 'no_prior_email' };

export async function planStepThread(input: {
  tenantId: string;
  leadId: string;
  sequenceId: string;
  stepOrder: number;
  /** Start of this enrollment: an earlier run of the same sequence is a different conversation. */
  enrolledAt: Date;
  accountId: string;
}): Promise<ThreadPlan> {
  const previous = await prisma.outboundMessage.findFirst({
    where: {
      tenantId: input.tenantId,
      leadId: input.leadId,
      sequenceId: input.sequenceId,
      status: 'sent',
      sequenceStepOrder: { lt: input.stepOrder },
      sentAt: { gte: input.enrolledAt },
    },
    orderBy: { sentAt: 'desc' },
    select: { id: true, subject: true, accountId: true, rfcMessageId: true },
  });

  const subject = stripReplyPrefix(previous?.subject);
  if (!previous || !subject) return { mode: 'new', reason: 'no_prior_email' };

  if (previous.accountId !== input.accountId) return { mode: 'continue', subject, reason: 'different_mailbox' };
  if (!previous.rfcMessageId) return { mode: 'continue', subject, reason: 'no_message_id' };

  return { mode: 'reply', subject: replySubject(subject) ?? subject, inReplyToOutboundId: previous.id };
}
