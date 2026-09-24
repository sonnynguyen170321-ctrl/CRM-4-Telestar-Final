import { prisma, withTenantRaw } from '@/lib/prisma';
import { createAppWorker } from '@/lib/bullmq';
import { enqueueReschedule } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import type { EmailSendPayload } from '@/lib/bullmq/types';
import { EmailService } from '@/lib/email/EmailService';
import { effectiveDryRun, isGlobalEmailPaused, isCanaryRecipientAllowed } from '@/lib/emailSafety';
import { generateUnsubscribeToken, buildUnsubscribeHeaders } from '@/lib/email/unsubscribe';
import { renderTemplate } from '@/lib/templates/render';
import {
  CLAIMABLE_STATUSES,
  OUTBOUND_STATUS,
  TERMINAL_STATUSES,
  classifySendFailure,
  isClaimLive,
} from '@/lib/email/idempotency';
import { isHtml, stripHtml } from '@/lib/email/sanitize';
import { nextSendAttemptAt } from '@/lib/email/sendWindow';
import { classifyRecipientFailure } from '@/lib/email/recipientFailure';
import { suppressRecipient } from '@/lib/email/suppress';
import { finalizeSequenceStep, releaseSequenceStep } from '@/lib/sequences/stepOutcome';
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
 * How many daily deferrals before the operator is told the mailbox cannot keep up.
 *
 * A message is never discarded for this — running out of quota says nothing about the
 * prospect, and dropping their email would turn a capacity shortage into silent data loss.
 * What an endlessly-deferred message *does* mean is that the cadences attached to this mailbox
 * need more capacity than it has, which is a decision for a person, so it is raised as one.
 */
const QUOTA_DEFERRAL_WARN_AFTER = 5;

/**
 * The next moment quota frees up: `atomicReserveQuota` compares against local midnight,
 * so that boundary — plus a small margin to avoid racing the comparison — is when a
 * deferred send becomes eligible again.
 */
function nextQuotaResetAt(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0);
}

/**
 * How many messages this mailbox has actually put on the wire in the last hour.
 *
 * Counted from `OutboundMessage`, not from a column. A counter would be one more number
 * written at intent and drifting from the truth — the mistake this file has now made twice.
 * `sending` and `reconciliation_required` count too: the provider may already have them.
 *
 * `excludeId` is the message being sent right now. It has already claimed itself by this
 * point, so without the exclusion it counts towards its own ceiling — a mailbox at cap 1
 * would defer its only message forever, and cap 40 would really be 39.
 */
async function sentInLastHour(accountId: string, excludeId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return prisma.outboundMessage.count({
    where: {
      accountId,
      id: { not: excludeId },
      OR: [
        { status: OUTBOUND_STATUS.SENT, sentAt: { gte: since } },
        { status: { in: [OUTBOUND_STATUS.SENDING, OUTBOUND_STATUS.RECONCILIATION_REQUIRED] }, claimedAt: { gte: since } },
      ],
    },
  });
}

/**
 * `withTenantRaw` because this is raw SQL, and raw SQL is outside the tenant extension — see
 * the note on the helper in `lib/prisma.ts`. Under RLS an unwrapped statement here would match
 * no policy, update zero rows, and return `false` without raising: every send would look like
 * a mailbox permanently at its cap, and outbound would stop with no error anywhere.
 */
async function atomicReserveQuota(tenantId: string, accountId: string): Promise<boolean> {
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const result = await withTenantRaw(tenantId, (db) => db.$executeRaw`
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
  `);
  return result > 0;
}

/**
 * Give back a slot reserved for a message that demonstrably never left the building.
 *
 * `atomicReserveQuota` increments before the provider call, because the increment *is* the
 * concurrency guard: two workers must not both decide there is room for the last send. That
 * makes the counter a reservation, and a reservation that is never released is capacity
 * destroyed. `failed` is in `CLAIMABLE_STATUSES`, so a `not_sent` error is not the end of the
 * message — it is retried, claims again, and reserves a *second* slot. Measured on production
 * 2026-09-18: 80 slots consumed against 50 messages actually sent, on a cap of 80. The mailbox
 * stopped for the day roughly 30 sends early, every day, and the sequence queue never drained.
 *
 * Only the `not_sent` branch may call this. An ambiguous failure goes to
 * `reconciliation_required`, where the message may well be with the prospect — that slot was
 * spent whether or not the provider told us so, and handing it back would let the mailbox
 * exceed its real cap, which is the one thing the cap exists to prevent.
 *
 * Guarded on `dailySendDate = today` so a release arriving after local midnight cannot reach
 * back and discount a day that has already rolled over, and floored at zero so a double
 * release (a retry of the same failure) cannot mint capacity.
 */
async function releaseQuota(tenantId: string, accountId: string): Promise<void> {
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  // `withTenantRaw` for the same reason the reserve above needs it: raw SQL sits outside the
  // tenant extension, and an unwrapped statement matches no RLS policy and silently updates
  // nothing — here that would look exactly like the bug this repairs.
  await withTenantRaw(tenantId, (db) => db.$executeRaw`
    UPDATE "EmailAccount"
    SET "dailySendCount" = GREATEST("dailySendCount" - 1, 0)
    WHERE id = ${accountId}
      AND "dailySendDate" = ${today}
  `);
}

/**
 * Park a message whose provider outcome is unknown.
 *
 * Deliberately not `failed`: `failed` means "definitely not delivered" and is claimable
 * again. This state is the one thing standing between an ambiguous provider call and a
 * duplicate delivery. `workers/maintenance.ts` resolves it.
 *
 * Nothing may *claim* a row out of this state — `reconciliation_required` is absent from
 * `CLAIMABLE_STATUSES` and the guard above returns early on it, so no second send can start.
 *
 * One write does leave it, and should: the worker that was already sending when the sweeper
 * parked the row (a provider call slower than the lease) finishes and records `sent` with a
 * real `providerMessageId`. That is evidence the send happened, from the only process in a
 * position to have it. An earlier version of this comment said nothing could move a row out at
 * all, which was simply not true of the code beneath it.
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

/**
 * How long one "your sends are failing" notification speaks for.
 *
 * The failures worth notifying about are rarely solitary — a revoked grant, a wrong
 * `ENCRYPTION_KEY`, a paused mailbox or an exhausted quota fails every send behind it the same
 * way. One notification per message would bury the mailbox it is warning about, so the first
 * failure in a window is loud and the rest are recorded on their rows and in the Sent folder.
 */
const SEND_FAILURE_NOTIFY_WINDOW_MS = 60 * 60 * 1000;

/**
 * Tell the owning rep that a send did not go out.
 *
 * Before this, `status: 'failed'` was written to the row and nothing else happened anywhere: no
 * activity on the lead, no notification, and the Sent folder queried `status: 'sent'` alone. The
 * rep saw "Email queued to …" and then silence indistinguishable from a prospect who had not yet
 * replied. The provider's reason was sitting in `errorMessage`, readable only by a director on
 * /admin/outbound.
 *
 * Raised only for *faults* — a provider rejection, an unusable mailbox, an exhausted quota. The
 * deliberate refusals (global pause, canary allowlist, suppression) are policy working as
 * configured; those now show in the Sent folder with their status and reason, which is the right
 * volume for an expected outcome.
 *
 * Never throws: a failed send must not be made worse by a failed notification about it.
 */
async function notifySendFailure(args: {
  tenantId: string;
  leadId: string;
  assignedToId: string | null | undefined;
  to: string;
  reason: string;
}): Promise<void> {
  const { tenantId, leadId, assignedToId, to, reason } = args;
  // No assignee means no one to tell. The row and the Sent folder still carry it.
  if (!assignedToId) return;

  try {
    const recent = await prisma.notification.findFirst({
      where: {
        tenantId,
        userId: assignedToId,
        type: 'email_send_failed',
        createdAt: { gte: new Date(Date.now() - SEND_FAILURE_NOTIFY_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent) return;

    await prisma.notification.create({
      data: {
        tenantId,
        userId: assignedToId,
        type: 'email_send_failed',
        title: 'Email did not send',
        text: `Your message to ${to} was not delivered: ${reason}. Check the Sent folder — other messages may have failed the same way.`,
        linkTo: `/leads/${leadId}`,
      },
    });
  } catch (err) {
    console.error('[worker:email] could not record a send-failure notification:', err);
  }
}

async function handleEmailSend(payload: EmailSendPayload) {
  const { outboundMessageId, accountId, to, subject, body, leadId } = payload;

  const existing = await prisma.outboundMessage.findUnique({
    where: { id: outboundMessageId },
    include: { lead: { select: { campaignId: true, assignedToId: true, timezone: true } } },
  });
  if (!existing) throw new Error(`OutboundMessage not found: ${outboundMessageId}`);

  // ── Terminal and ambiguous states are never sent again ────────────────────
  // A row is only re-sendable from `pending` or `failed`. Everything else either
  // already delivered or *may* have delivered, and a resend is the exact duplicate this
  // pipeline exists to prevent.
  if (TERMINAL_STATUSES.includes(existing.status)) {
    // Terminal for the *message*, but the step behind it may still be open — a job re-driven
    // onto a row that was reconciled in the meantime arrives here, and returning without
    // settling would leave that cadence stalled with nothing left to wake it. Both calls are
    // convergent, so a step that is already settled is a no-op.
    if (payload.sequenceStepRef) {
      if (existing.status === OUTBOUND_STATUS.SENT) {
        await finalizeSequenceStep(payload.sequenceStepRef);
      } else {
        await releaseSequenceStep(payload.sequenceStepRef, 'the message was permanently failed');
      }
    }
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
      // The send did get through, so the step it belongs to is settled here — the lost write
      // this branch recovers included the settle.
      if (payload.sequenceStepRef) await finalizeSequenceStep(payload.sequenceStepRef);
      return {
        skipped: true,
        reason: 'already_sent_provider_reconcile',
        providerMessageId: existing.providerMessageId,
      };
    }
    // Another worker may be sending this RIGHT NOW. Status alone cannot tell a crashed
    // attempt from a live one, and treating a live claim as dead parks a perfectly healthy
    // send into `reconciliation_required` — a state nothing here may move it out of, so it
    // takes a human to clear. `claimedAt` is what distinguishes them.
    //
    // Found by enabling DB-level RLS: its extra round-trips widen the gap between the winner's
    // claim and its provider write enough that losers reliably land here. Without RLS the
    // losers usually read `pending` first and stop at the CAS below, so the race existed but
    // the test passed on timing.
    //
    // The trade this makes, stated because it is a real one: if the winner dies immediately,
    // this row now waits for `repairStaleSending` rather than being parked here at once, so a
    // crashed send takes up to the lease to become visible. That is the sweeper's job and it
    // runs on the same threshold. The previous behaviour reached a human faster but was wrong
    // in the common case, and being wrong quickly is not better.
    if (isClaimLive(existing.claimedAt)) {
      return { skipped: true, reason: 'claim_in_flight' };
    }

    // Past the lease the claim is genuinely abandoned. `workers/maintenance.ts` sweeps on the
    // same threshold and owns the recovery; parking it here keeps the row out of the claimable
    // pool until it does.
    await markReconciliationRequired(
      outboundMessageId,
      'Re-entered after an abandoned claim — provider outcome unknown'
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
  if (!effectiveDryRun(existing.tenantId) && !isCanaryRecipientAllowed(to)) {
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
      data: {
        // Terminal, not `failed`. `failed` is claimable, so a suppressed message was picked up
        // by the redrive sweep, refused here again, written back as `failed` — and this branch
        // never increments `attemptCount`, so the redrive cap could never end the loop. It sat
        // in the backlog forever, being re-queued forever, and could never reach a final state.
        status: OUTBOUND_STATUS.PERMANENTLY_FAILED,
        errorMessage: `Recipient suppressed: ${suppressed.reason}`,
      },
    });
    // A suppressed address means the step will never be sent, so the cadence must not wait on
    // it. Without this the enrollment stays active with a step that can only ever be refused.
    if (payload.sequenceStepRef) {
      await releaseSequenceStep(payload.sequenceStepRef, `recipient suppressed: ${suppressed.reason}`);
    }
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
    await notifySendFailure({
      tenantId: existing.tenantId,
      leadId: existing.leadId,
      assignedToId: existing.lead?.assignedToId,
      to,
      reason: 'the sending mailbox no longer exists',
    });
    throw new Error(`Email account not found: ${accountId}`);
  }

  const blocked = evaluateSendBlock(account);
  if (blocked) {
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: { status: OUTBOUND_STATUS.FAILED, errorMessage: blocked.errorMessage },
    });
    await notifySendFailure({
      tenantId: existing.tenantId,
      leadId: existing.leadId,
      assignedToId: existing.lead?.assignedToId,
      to,
      reason: blocked.errorMessage,
    });
    return { skipped: true, reason: blocked.reason };
  }

  // Hourly ceiling first, and before the daily reservation, so a deferral here costs no slot.
  // The daily cap was the only ceiling the CRM modelled; the provider also has an hourly one,
  // and 228 messages discovered it the hard way.
  if (account.hourlyCap > 0 && (await sentInLastHour(accountId, outboundMessageId)) >= account.hourlyCap) {
    const resumeAt = nextSendAttemptAt({
      now: new Date(),
      minHours: 1,
      timezone: existing.lead?.timezone ?? null,
      seed: outboundMessageId,
    });
    await prisma.outboundMessage.update({
      where: { id: outboundMessageId },
      data: {
        status: OUTBOUND_STATUS.PENDING,
        errorMessage: `Mailbox hourly limit reached — deferred to ${resumeAt.toISOString()}`,
      },
    });
    await enqueueReschedule(JobType.EMAIL_SEND, payload, {
      tenantId: existing.tenantId,
      delay: Math.max(0, resumeAt.getTime() - Date.now()),
      discriminator: `hourly:${resumeAt.toISOString()}`,
    });
    return { deferred: true, skipped: true, reason: 'hourly_quota', resumeAt };
  }

  // Atomically reserve quota
  const quotaOk = await atomicReserveQuota(existing.tenantId, accountId);
  if (!quotaOk) {
    // Quota is a temporary condition, not a delivery failure, so the row goes back into
    // the claimable pool rather than to `failed`. It must be re-enqueued in the same
    // breath: `pending` with no live job left is a message that stalls forever, which is
    // worse than the `failed` this replaced because nothing surfaces it.
    const attemptsSoFar = existing.attemptCount + 1; // the claim above already incremented

    // A message is never thrown away for want of capacity.
    //
    // This used to fail the message on the fifth deferral, on the reasoning that an
    // endlessly-rescheduled send is a failure nobody sees. The reasoning was right and the
    // remedy was wrong: running out of quota says nothing about the prospect, so discarding
    // their email turns an operational shortage into silent data loss. Production proved it —
    // `ulrika.soderholm@arcticgroup.se` was dropped on 2026-09-21 having never been written to,
    // with 29 more one deferral away, because one mailbox carries 100% of an 821-cadence
    // workload at 80 sends a day.
    //
    // So the deferral continues, and the *shortage* is what gets raised. Once per message, so a
    // sustained backlog does not bury the operator in notifications it has already sent.
    if (attemptsSoFar === QUOTA_DEFERRAL_WARN_AFTER) {
      await notifySendFailure({
        tenantId: existing.tenantId,
        leadId: existing.leadId,
        assignedToId: existing.lead?.assignedToId,
        to,
        reason:
          `still waiting after ${attemptsSoFar} days — this mailbox has less daily capacity ` +
          `than its cadences need. The email is still queued and will go out; the backlog is ` +
          `what needs a decision.`,
      });
    }

    // Spread across tomorrow's window rather than stacking every deferred message on the
    // same instant — see `nextSendAttemptAt`.
    const resumeAt = nextSendAttemptAt({
      now: nextQuotaResetAt(),
      minHours: 0,
      timezone: existing.lead?.timezone ?? null,
      seed: outboundMessageId,
    });
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
  // is explicitly "false" — demo tenant ALWAYS dry-runs at worker side-effect boundary.
  if (effectiveDryRun(existing.tenantId)) {
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

    const baseUrl = process.env.NEXTAUTH_URL || `https://${process.env.CRM_DOMAIN || 'crm.telestar.cloud'}`;
    const unsubToken = generateUnsubscribeToken({
      tenantId: existing.tenantId,
      email: to,
      leadId: existing.leadId || undefined,
      campaignId: existing.lead?.campaignId || undefined,
    });
    const headers = buildUnsubscribeHeaders(baseUrl, unsubToken);

    const emailService = await EmailService.fromAccount(account);
    providerMessageId = await emailService.send({
      from: account.email,
      to,
      subject: finalSubject,
      text: textPayload,
      html: htmlPayload,
      headers,
      attachments: mappedAttachments,
    });
  } catch (sendErr: unknown) {
    const errorMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
    // Two different refusals wear the same `550`. One is about us — our hourly quota, our
    // policy, our blocklist — and the message should be tried again later. The other is about
    // the address, and trying again is how a sender's reputation is spent.
    //
    // A refusal of the *recipient* is also, necessarily, proof the message was never sent: the
    // provider rejected the envelope. `classifySendFailure` did not know that, so
    // `550 5.1.1 user unknown` came back `ambiguous` and the message went to
    // `reconciliation_required` — where it waited 24 hours to become `permanently_failed` with
    // nobody suppressing the address. That is how production reached 0 suppression rows while
    // the provider was refusing addresses outright.
    const deadAddress = classifyRecipientFailure(sendErr) === 'recipient';

    // Only errors that prove the message never left the building return the row to the
    // claimable pool. A timeout or a dropped connection might still deliver, so it goes
    // to reconciliation instead — the retry BullMQ is about to schedule will then bounce
    // off the status guard rather than send a second copy.
    if (deadAddress || classifySendFailure(sendErr) === 'not_sent') {
      await prisma.outboundMessage.update({
        where: { id: outboundMessageId },
        data: {
          // `permanently_failed` is terminal and outside every retry sweep. `failed` is
          // claimable, and a claimable dead address is a bounce on a schedule.
          status: deadAddress ? OUTBOUND_STATUS.PERMANENTLY_FAILED : OUTBOUND_STATUS.FAILED,
          errorMessage,
        },
      });

      if (deadAddress) {
        await suppressRecipient({
          tenantId: existing.tenantId,
          email: to,
          leadId: existing.leadId,
          // The operator's 2026-09-23 rule: any bounce suppresses immediately, with no second
          // attempt, hard or soft. So the distinction is recorded but not acted on differently.
          reason: 'hard_bounce',
          detail: errorMessage,
          actorUserId: existing.lead?.assignedToId ?? null,
        });
      }

      // The row is claimable again, so this attempt's slot must go back with it. Without this
      // the retry reserves a second one and the mailbox pays twice for one message.
      await releaseQuota(existing.tenantId, accountId);
      // And the cadence stops: the prospect received nothing, so step 2 must not go out
      // referencing a step 1 that was refused. A person decides what happens next.
      if (payload.sequenceStepRef) await releaseSequenceStep(payload.sequenceStepRef, errorMessage);
    } else {
      await markReconciliationRequired(outboundMessageId, errorMessage);
    }
    // Both branches, because both mean the rep is waiting on a reply to a message that is not
    // with the prospect. `reconciliation_required` is the more dangerous of the two to leave
    // silent: it resolves no sooner than the 24-hour sweep.
    await notifySendFailure({
      tenantId: existing.tenantId,
      leadId: existing.leadId,
      assignedToId: existing.lead?.assignedToId,
      to,
      reason: errorMessage,
    });
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

  // The provider has the message. *Now* the step is complete: the task closes, the counters
  // move and the cadence advances. Doing this at enqueue time is what recorded 228 deliveries
  // that never happened on 2026-09-21 — see lib/sequences/stepOutcome.ts.
  if (payload.sequenceStepRef) await finalizeSequenceStep(payload.sequenceStepRef);

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
