import { prisma } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { enqueueReschedule } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import type { EmailSendPayload } from '@/lib/bullmq/types';
import { EmailService } from '@/lib/email/EmailService';
import { isDryRun, isGlobalEmailPaused, isCanaryRecipientAllowed } from '@/lib/emailSafety';
import { renderTemplate } from '@/lib/templates/render';
import {
  CLAIMABLE_STATUSES,
  OUTBOUND_STATUS,
  TERMINAL_STATUSES,
  classifySendFailure,
} from '@/lib/email/idempotency';

function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/** Minimal account shape the deliverability preflight needs. */
type SendGateAccount = {
  isActive: boolean;
  sendPausedAt: Date | null;
  sendPauseReason: string | null;
  healthLevel: string | null;
};

/**
 * Decides whether the deliverability layer blocks this send.
 *
 * A manager-set pause is an unconditional hard block. A critical health score is
 * advisory by default — it raises alerts, but only stops sending when
 * EMAIL_HEALTH_AUTOPAUSE is explicitly enabled, so a miscalibrated threshold
 * cannot silently halt a live client campaign.
 *
 * Exported for tests; pure so it needs no database.
 */
export function evaluateSendBlock(
  account: SendGateAccount
): { reason: string; errorMessage: string } | null {
  if (!account.isActive) {
    return { reason: 'account_inactive', errorMessage: 'Email account is inactive' };
  }

  if (account.sendPausedAt !== null) {
    const why = account.sendPauseReason ? `: ${account.sendPauseReason}` : '';
    return { reason: 'account_paused', errorMessage: `Sending is paused for this inbox${why}` };
  }

  if (account.healthLevel === 'critical' && process.env.EMAIL_HEALTH_AUTOPAUSE === 'true') {
    return {
      reason: 'health_critical',
      errorMessage: 'Inbox health is critical and auto-pause is enabled',
    };
  }

  return null;
}

/**
 * How many times a single message may be pushed to the next quota window before it is
 * treated as undeliverable. Without a cap, a permanently over-subscribed mailbox would
 * reschedule the same message forever and no one would ever see a failure.
 */
const MAX_QUOTA_DEFERRALS = 5;

/**
 * The next moment quota frees up: `atomicReserveQuota` compares against local midnight,
 * so that boundary — plus a small margin to avoid racing the comparison — is when a
 * deferred send becomes eligible again.
 */
function nextQuotaResetAt(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0);
}

async function atomicReserveQuota(accountId: string): Promise<boolean> {
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const result = await prisma.$executeRaw`
    UPDATE "EmailAccount"
    SET
      "dailySendCount" = CASE
        WHEN "dailySendDate" IS NULL OR "dailySendDate" < ${today} THEN 1
        ELSE "dailySendCount" + 1
      END,
      "dailySendDate" = ${today}
    WHERE id = ${accountId}
      AND (
        "dailySendDate" IS NULL
        OR "dailySendDate" < ${today}
        OR "dailySendCount" < "dailyCap"
      )
  `;
  return result > 0;
}

/**
 * Park a message whose provider outcome is unknown.
 *
 * Deliberately not `failed`: `failed` means "definitely not delivered" and is claimable
 * again. This state is the one thing standing between an ambiguous provider call and a
 * duplicate delivery, so nothing in the send path may move a row out of it.
 * `workers/maintenance.ts` resolves it.
 */
async function markReconciliationRequired(outboundMessageId: string, reason: string): Promise<void> {
  await prisma.outboundMessage.update({
    where: { id: outboundMessageId },
    data: {
      status: OUTBOUND_STATUS.RECONCILIATION_REQUIRED,
      errorMessage: `Ambiguous send, awaiting reconciliation: ${reason}`,
    },
  });
}

async function handleEmailSend(payload: EmailSendPayload) {
  const { outboundMessageId, accountId, to, subject, body, leadId } = payload;

  const existing = await prisma.outboundMessage.findUnique({
    where: { id: outboundMessageId },
    include: { lead: { select: { campaignId: true, assignedToId: true } } },
  });
  if (!existing) throw new Error(`OutboundMessage not found: ${outboundMessageId}`);

  // ── Terminal and ambiguous states are never sent again ────────────────────
  // A row is only re-sendable from `pending` or `failed`. Everything else either
  // already delivered or *may* have delivered, and a resend is the exact duplicate this
  // pipeline exists to prevent.
  if (TERMINAL_STATUSES.includes(existing.status)) {
    return {
      skipped: true,
      reason: existing.status === OUTBOUND_STATUS.SENT ? 'already_sent' : 'permanently_failed',
      providerMessageId: existing.providerMessageId ?? undefined,
    };
  }
  if (existing.status === OUTBOUND_STATUS.RECONCILIATION_REQUIRED) {
    return { skipped: true, reason: 'awaiting_reconciliation' };
  }
  if (existing.status === OUTBOUND_STATUS.SENDING) {
    // A previous attempt claimed this row and did not finish. If it recorded a provider
    // id, the send got through and only the final write was lost — settle it as sent.
    // Otherwise the outcome is genuinely unknown, so hand it to reconciliation rather
    // than guessing. This is the path a crash between the provider call and the DB write
    // lands on, and the reason that crash cannot produce a second delivery.
    if (existing.providerMessageId) {
      await prisma.outboundMessage.update({
        where: { id: outboundMessageId },
        data: { status: OUTBOUND_STATUS.SENT, sentAt: existing.sentAt ?? new Date() },
      });
      return {
        skipped: true,
        reason: 'already_sent_provider_reconcile',
        providerMessageId: existing.providerMessageId,
      };
    }
    await markReconciliationRequired(
      outboundMessageId,
      'Re-entered while already claimed — provider outcome unknown'
    );
    return { skipped: true, reason: 'reconciliation_required' };
  }

  // ── Claim ─────────────────────────────────────────────────────────────────
  // Compare-and-set: exactly one worker moves pending/failed -> sending. Everyone else
  // sees count 0 and stops here, before consuming quota or touching the provider. Same
  // single-statement CAS the campaign-membership and task-completion paths use — it is
  // safe on the Neon HTTP driver, which has no interactive transactions.
  const claim = await prisma.outboundMessage.updateMany({
    where: { id: outboundMessageId, status: { in: [...CLAIMABLE_STATUSES] } },
    data: {
      status: OUTBOUND_STATUS.SENDING,
      claimedAt: new Date(),
      attemptCount: { increment: 1 },
      errorMessage: null,
    },
  });
  if (claim.count !== 1) {
    return { skipped: true, reason: 'claim_lost' };
  }

  // ── Emergency Kill Switch ─────────────────────────────────────────────────
  if (isGlobalEmailPaused()) {
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: OUTBOUND_STATUS.FAILED, errorMessage: 'Sending blocked: global email pause is active' },
    });
    return { skipped: true, reason: 'global_email_paused' };
  }

  // ── Canary Recipient Restriction ──────────────────────────────────────────
  if (!isDryRun() && !isCanaryRecipientAllowed(to)) {
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: OUTBOUND_STATUS.FAILED, errorMessage: `Canary restriction: recipient ${to} is not in allowed list` },
    });
    return { skipped: true, reason: 'canary_recipient_blocked' };
  }

  // Check suppression
  const recipientDomain = to.split('@')[1];
  const suppressed = await prisma.suppressionEntry.findFirst({
    where: {
      tenantId: existing.tenantId,
      AND: [
        { OR: [{ email: to }, { domain: recipientDomain }] },
        ...(leadId && existing.lead?.campaignId
          ? [{ OR: [{ campaignId: existing.lead.campaignId }, { campaignId: null }] }]
          : []),
      ],
    },
  });
  if (suppressed) {
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: OUTBOUND_STATUS.FAILED, errorMessage: `Recipient suppressed: ${suppressed.reason}` },
    });
    return { skipped: true, reason: 'suppressed' };
  }

  // Deliverability preflight — runs BEFORE quota reservation so a blocked send
  // never consumes a slot it cannot use (quota is not refunded on failure).
  // Full row (not a select) because EmailService.fromAccount needs the encrypted
  // credentials further down — this replaces the fetch that used to sit inside
  // the send block, so the account is still read exactly once.
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) {
    // Release the claim before throwing: nothing was sent, so the row belongs back in the
    // claimable pool rather than in the ambiguous state a bare throw would strand it in.
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: OUTBOUND_STATUS.FAILED, errorMessage: `Email account not found: ${accountId}` },
    });
    throw new Error(`Email account not found: ${accountId}`);
  }

  const blocked = evaluateSendBlock(account);
  if (blocked) {
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: OUTBOUND_STATUS.FAILED, errorMessage: blocked.errorMessage },
    });
    return { skipped: true, reason: blocked.reason };
  }

  // Atomically reserve quota
  const quotaOk = await atomicReserveQuota(accountId);
  if (!quotaOk) {
    // Quota is a temporary condition, not a delivery failure, so the row goes back into
    // the claimable pool rather than to `failed`. It must be re-enqueued in the same
    // breath: `pending` with no live job left is a message that stalls forever, which is
    // worse than the `failed` this replaced because nothing surfaces it.
    const attemptsSoFar = existing.attemptCount + 1; // the claim above already incremented
    if (attemptsSoFar >= MAX_QUOTA_DEFERRALS) {
      await prisma.outboundMessage.update({
        where: { id: outboundMessageId },
        data: {
          status: OUTBOUND_STATUS.FAILED,
          errorMessage: `Daily send limit reached on ${attemptsSoFar} consecutive attempts`,
        },
      });
      return { skipped: true, reason: 'quota_exhausted_max_deferrals' };
    }

    const resumeAt = nextQuotaResetAt();
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: {
        status: OUTBOUND_STATUS.PENDING,
        errorMessage: `Daily send limit reached — deferred to ${resumeAt.toISOString()}`,
      },
    });
    await enqueueReschedule(
      JobType.EMAIL_SEND,
      payload,
      {
        tenantId: existing.tenantId,
        delay: Math.max(0, resumeAt.getTime() - Date.now()),
        discriminator: `quota:${resumeAt.toISOString()}`,
      }
    );
    return { deferred: true, skipped: true, reason: 'quota_exhausted', resumeAt };
  }

  // Render template variables if lead is available
  let finalSubject = subject;
  let finalBody = body;
  if (leadId) {
    const leadForRender = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });
    if (leadForRender) {
      finalSubject = renderTemplate(subject, leadForRender as any, leadForRender.assignedTo as any);
      finalBody = renderTemplate(body, leadForRender as any, leadForRender.assignedTo as any);
    }
  }

  // Dry-run gate for safe demo/staging execution. Engaged unless EMAIL_SEND_DRY_RUN
  // is explicitly "false" — see lib/emailSafety.ts for why the default is inverted.
  if (isDryRun()) {
    const dryRunProviderId = `dry-run-${outboundMessageId}`;
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: {
        status: OUTBOUND_STATUS.SENT,
        providerMessageId: dryRunProviderId,
        sentAt: new Date(),
        errorMessage: null,
      },
    });

    const resolvedLeadId = leadId ?? existing.leadId;
    const resolvedUserId = existing.lead?.assignedToId ?? 'system';
    await prisma.activity.create({
      data: {
        userId: resolvedUserId,
        leadId: resolvedLeadId,
        type: 'email_sent',
        channel: 'email',
        description: `[DRY RUN] Email would have been sent to ${to}`,
        metadata: {
          dryRun: true,
          subject: finalSubject,
          accountId,
          outboundMessageId,
        },
      },
    });

    if (resolvedLeadId) {
      await prisma.lead.update({
        where: { id: resolvedLeadId },
        data: { lastContactedAt: new Date() },
      });
    }

    return {
      success: true,
      dryRun: true,
      outboundMessageId,
      providerMessageId: dryRunProviderId,
    };
  }

  // Send
  let providerMessageId: string | undefined;
  try {
    // Fetch attachments if templateId is present
    const attachments = existing.templateId
      ? await prisma.attachment.findMany({ where: { templateId: existing.templateId } })
      : [];

    const mappedAttachments = attachments.map((att) => ({
      filename: att.name,
      content: Buffer.from(att.content, 'base64'),
      contentType: att.contentType,
    }));

    // Append signature if available
    let bodyWithSig = finalBody;
    if (account.signature) {
      if (isHtml(finalBody)) {
        bodyWithSig = `${finalBody}<br><br>--<br>${account.signature}`;
      } else {
        bodyWithSig = `${finalBody}\n\n--\n${stripHtml(account.signature)}`;
      }
    }

    // Prepare text and HTML versions
    let textPayload: string;
    let htmlPayload: string;
    if (isHtml(bodyWithSig)) {
      htmlPayload = bodyWithSig;
      textPayload = stripHtml(bodyWithSig);
    } else {
      textPayload = bodyWithSig;
      htmlPayload = `<div style="font-family: sans-serif; white-space: pre-wrap;">${bodyWithSig}</div>`;
    }

    const emailService = await EmailService.fromAccount(account);
    providerMessageId = await emailService.send({
      from: account.email,
      to,
      subject: finalSubject,
      text: textPayload,
      html: htmlPayload,
      attachments: mappedAttachments,
    });
  } catch (sendErr: unknown) {
    const errorMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
    // Only errors that prove the message never left the building return the row to the
    // claimable pool. A timeout or a dropped connection might still deliver, so it goes
    // to reconciliation instead — the retry BullMQ is about to schedule will then bounce
    // off the status guard rather than send a second copy.
    if (classifySendFailure(sendErr) === 'not_sent') {
      await prisma.outboundMessage.update({
        where: { id: outboundMessageId },
        data: { status: OUTBOUND_STATUS.FAILED, errorMessage },
      });
    } else {
      await markReconciliationRequired(outboundMessageId, errorMessage);
    }
    throw sendErr;
  }

  // Persist the provider's confirmation. If *this* write fails the job throws with the
  // row still `sending` and no provider id, so the next attempt routes to reconciliation
  // and the provider is never called twice.
  await prisma.outboundMessage.update({
    where: { id: outboundMessageId },
    data: {
      status: OUTBOUND_STATUS.SENT,
      providerMessageId: providerMessageId ?? null,
      sentAt: new Date(),
    },
  });

  // Log activity and update lead
  const resolvedLeadId = leadId ?? existing.leadId;
  const resolvedUserId = existing.lead?.assignedToId ?? 'system';
  await prisma.activity.create({
    data: {
      userId: resolvedUserId,
      leadId: resolvedLeadId,
      type: 'email_sent',
      channel: 'email',
      description: `Email sent to ${to}`,
      metadata: { subject: finalSubject, accountId, outboundMessageId },
    },
  });
  await prisma.lead.update({
    where: { id: resolvedLeadId },
    data: { lastContactedAt: new Date() },
  });

  return { success: true, outboundMessageId, providerMessageId };
}

export function createEmailWorker() {
  return createAppWorker(
    'email',
    async (job) => {
      if (job.name !== JobType.EMAIL_SEND) return;
      return handleEmailSend(job.data as EmailSendPayload);
    },
    { concurrency: 5 }
  );
}

export { handleEmailSend };
