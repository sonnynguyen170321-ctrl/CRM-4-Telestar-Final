import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, requireAuth } from '@/lib/auth';
import { z } from 'zod';
import { inboxScope, threadSubjectKey } from '@/lib/inbox/scope';
import type { SessionUser } from '@/lib/auth';
import { createOutboundMessage, emailSendPayloadFor, enqueueTimedEmailSend } from '@/lib/workflows/email';
import { clearDraft, resolveComposerSendOptions, reviveCancelled } from '@/lib/email/composedSend';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';
import { newRequestId } from '@/lib/email/idempotency';
import { mailboxRefusal, recipientRefusal } from '@/lib/email/sendGate';
import { composeAttachmentIds, copyRecipientList, sendControlFields } from '@/lib/validation/schemas';
import { abandonOutbound, finalizeComposed, prepareComposed } from '@/lib/email/prepareComposed';

const replySchema = z.object({
  ...sendControlFields,
  body: z.string().trim().min(1, 'Reply body is required').max(100_000),
  subject: z.string().max(998).optional().default(''),
  leadId: z.string().min(1, 'Lead ID is required').max(64),
  clientRequestId: z.string().min(8).max(100).optional(),
  cc: copyRecipientList.optional(),
  bcc: copyRecipientList.optional(),
  attachmentIds: composeAttachmentIds.optional(),
});

/** How many of the lead's latest messages are searched for the one in the open thread. */
const THREAD_LOOKBACK = 50;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // Guard: a missing tenant would let this send from another tenant's lead/account.
  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const { id: threadKey } = await params;

  try {
    const parsed = replySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid reply' }, { status: 400 });
    }
    const { body: rawBody, subject, leadId, clientRequestId, cc, bcc, attachmentIds } = parsed.data;
    const options = await resolveComposerSendOptions(user.tenantId, parsed.data);
    if (!options.ok) return options.response;
    const { timing, trackOpens, trackClicks } = options.value;

    // 1. Fetch Lead details — scoped to the caller's tenant.
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId: user.tenantId },
      select: { id: true, email: true, assignedToId: true, campaignId: true, emailInvalid: true },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Associated lead not found' }, { status: 404 });
    }

    // 2. The mailbox the prospect wrote to — the one their latest message in an inbox this viewer
    //    may open landed in (owner, 2026-10-07). It used to be any mailbox of the lead holder,
    //    which could change the domain mid-conversation and broke the thread.
    //
    //    Same tenant is not the same as yours: the latest message is looked for only inside the
    //    viewer's inbox scope (lib/inbox/scope.ts), so a viewer who cannot see this conversation
    //    finds none and is refused. An impersonated send cannot be recalled, which is why the
    //    gate is here and not in the UI.
    //
    //    The open thread's own message first (threads group by lead and subject, as GET /api/inbox
    //    builds them); the lead's latest message when the thread holds none of theirs.
    const scope = await inboxScope(await getVisibleUserIds(user));
    const recent = await prisma.inboundMessage.findMany({
      where: { tenantId: user.tenantId, leadId: lead.id, isBounce: false, AND: [scope.inbound] },
      orderBy: { date: 'desc' },
      select: { id: true, accountId: true, subject: true },
      take: THREAD_LOOKBACK,
    });
    const threadSubject = threadKey.startsWith(`${lead.id}-`) ? threadKey.slice(lead.id.length + 1) : null;
    const latest = recent.find((m) => threadSubjectKey(m.subject) === threadSubject) ?? recent[0];
    if (!latest) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const account = await prisma.emailAccount.findFirst({
      where: { id: latest.accountId, tenantId: user.tenantId, isActive: true },
    });

    if (!account) {
      return NextResponse.json({ error: 'The mailbox this prospect wrote to is no longer connected' }, { status: 400 });
    }

    // The same refusals as a one-off send, while the rep is still looking at the reply box. The
    // worker checks again right before the provider call, but by then this route has said 200 and
    // the UI "queued"; the only record would be a failed row nobody on screen was shown.
    const refusal =
      mailboxRefusal(account) ??
      (await recipientRefusal({
        tenantId: user.tenantId,
        email: lead.email,
        campaignId: lead.campaignId,
        emailInvalid: lead.emailInvalid,
      }));
    if (refusal) {
      return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status });
    }

    // CC/BCC suppression, the caller's own attachments within the cap, a sanitised HTML body
    // (the editor's output used to be queued as typed) - lib/email/prepareComposed.ts.
    const prepared = await prepareComposed({
      tenantId: user.tenantId,
      userId: user.id,
      campaignId: lead.campaignId,
      to: lead.email,
      cc,
      bcc,
      body: rawBody,
      attachmentIds,
    });
    if (!prepared.ok) return prepared.response;
    const body = prepared.value.body;

    // 3. Record the send through the shared service, so this path gets the same
    //    upsert-on-a-durable-key treatment as sequence and compose sends. It used to
    //    build its own `reply-<timestamp>-<random>` key and call `create` directly,
    //    which made every retry a brand-new row and therefore a second delivery.
    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

    const startedAt = Date.now();
    const outbound = await createOutboundMessage({
      source: {
        kind: 'reply',
        // The lead and the sender are part of the key: the thread key and request id arrive from
        // the client, and two replies may only ever collapse into one when they are the same reply
        // on the same lead by the same person. A colleague's colliding id lands on its own row.
        threadKey: `${lead.id}:${user.id}:${threadKey}`,
        requestId: clientRequestId ?? newRequestId(),
      },
      leadId: lead.id,
      accountId: account.id,
      to: lead.email,
      cc: prepared.value.cc,
      bcc: prepared.value.bcc,
      subject: replySubject,
      body,
      tenantId: user.tenantId,
      // The prospect's message in the open thread: the worker puts its Message-ID in
      // In-Reply-To / References so the reply lands in their thread.
      inReplyToInboundId: latest.id,
      scheduledFor: timing.scheduledFor,
      composedById: user.id,
      trackOpens,
      trackClicks,
    });

    // Undone, then written again under the same key: the author's to revive (see the send route).
    let row = outbound;
    let revived = false;
    if (row.status === OUTBOUND_STATUS.CANCELLED && row.composedById === user.id) {
      const back = await reviveCancelled(user.tenantId, user.id, row.id, {
        subject: replySubject, body, cc: prepared.value.cc, bcc: prepared.value.bcc,
        scheduledFor: timing.scheduledFor, trackOpens, trackClicks,
      });
      if (!back) return NextResponse.json({ error: 'This reply was cancelled. Start a new one.', code: 'cancelled' }, { status: 409 });
      row = back;
      revived = true;
    }

    // An idempotency hit returns the row first written under this key. It must be this reply on
    // this lead; anything else is refused rather than sent with this request's content.
    if (outbound.leadId !== lead.id || outbound.tenantId !== user.tenantId || outbound.accountId !== account.id) {
      return NextResponse.json({ error: 'Duplicate request' }, { status: 409 });
    }

    // A failure here makes the reply terminal: one the rep was told failed must not be swept up and
    // sent later without its attachments.
    const attachFailure = await finalizeComposed(user.tenantId, user.id, revived ? { ...row, createdAt: undefined } : outbound, startedAt, prepared.value);
    if (attachFailure) return attachFailure;

    // 4. Enqueue email send workflow
    try {
      await enqueueTimedEmailSend(emailSendPayloadFor(row), user.tenantId, timing);
    } catch (enqueueError) {
      if (outbound.createdAt.getTime() >= startedAt) {
        await abandonOutbound(user.tenantId, outbound.id, 'Not sent: it could not be queued').catch(() => undefined);
      }
      throw enqueueError;
    }

    await clearDraft(user.tenantId, user.id, `thread:${threadKey}`);

    return NextResponse.json({
      success: true,
      sendAt: timing.kind === 'scheduled' ? timing.scheduledFor : null,
      undoSeconds: timing.kind === 'undo' ? Math.round(timing.delayMs / 1000) : 0,
      // Queued, not sent: the worker sends it. `status` is the row's state now; the Sent folder
      // shows how it ends (sent, deferred, failed, bounced).
      message: 'Reply queued',
      status: outbound.status,
      // Copies left off (suppressed, or bounced earlier); the composer says so.
      droppedCopies: prepared.value.droppedCopies,
      outboundMessage: {
        id: outbound.id,
        type: 'outbound',
        fromEmail: account.email,
        fromName: 'Me',
        to: outbound.to,
        subject: outbound.subject,
        body: outbound.body,
        date: outbound.createdAt,
        scheduledFor: timing.scheduledFor,
        canManageSchedule: true,
      },
    });
  } catch (error) {
    console.error('[inbox-reply] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
