import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, requireAuth } from '@/lib/auth';
import { z } from 'zod';
import { inboxScope, threadSubjectKey } from '@/lib/inbox/scope';
import type { SessionUser } from '@/lib/auth';
import { createOutboundMessage, enqueueEmailSendWorkflow } from '@/lib/workflows/email';
import { newRequestId } from '@/lib/email/idempotency';

const replySchema = z.object({
  body: z.string().trim().min(1, 'Reply body is required').max(100_000),
  subject: z.string().max(998).optional().default(''),
  leadId: z.string().min(1, 'Lead ID is required').max(64),
  clientRequestId: z.string().min(8).max(100).optional(),
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
    const { body, subject, leadId, clientRequestId } = parsed.data;

    // 1. Fetch Lead details — scoped to the caller's tenant.
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId: user.tenantId },
      select: { id: true, email: true, assignedToId: true, campaignId: true },
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
      select: { accountId: true, subject: true },
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

    // 3. Record the send through the shared service, so this path gets the same
    //    upsert-on-a-durable-key treatment as sequence and compose sends. It used to
    //    build its own `reply-<timestamp>-<random>` key and call `create` directly,
    //    which made every retry a brand-new row and therefore a second delivery.
    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

    const outbound = await createOutboundMessage({
      source: {
        kind: 'reply',
        // The lead is part of the key: the thread key arrives from the client, and two replies may
        // only ever collapse into one when they are the same reply on the same lead.
        threadKey: `${lead.id}:${threadKey}`,
        requestId: clientRequestId ?? newRequestId(),
      },
      leadId: lead.id,
      accountId: account.id,
      to: lead.email,
      subject: replySubject,
      body,
      tenantId: user.tenantId,
    });

    // An idempotency hit returns the row first written under this key. It must be this reply on
    // this lead; anything else is refused rather than sent with this request's content.
    if (outbound.leadId !== lead.id || outbound.tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Duplicate request' }, { status: 409 });
    }

    // 4. Enqueue email send workflow
    await enqueueEmailSendWorkflow(
      {
        outboundMessageId: outbound.id,
        accountId: account.id,
        to: lead.email,
        subject: replySubject,
        body,
        leadId: lead.id,
      },
      user.tenantId!
    );

    return NextResponse.json({
      success: true,
      message: 'Reply enqueued successfully',
      outboundMessage: {
        id: outbound.id,
        type: 'outbound',
        fromEmail: account.email,
        fromName: 'Me',
        to: outbound.to,
        subject: outbound.subject,
        body: outbound.body,
        date: outbound.createdAt,
      },
    });
  } catch (error) {
    console.error('[inbox-reply] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
