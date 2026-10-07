import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, requireAuth } from '@/lib/auth';
import { inboxScope } from '@/lib/inbox/scope';
import type { SessionUser } from '@/lib/auth';
import { createOutboundMessage, enqueueEmailSendWorkflow } from '@/lib/workflows/email';
import { newRequestId } from '@/lib/email/idempotency';

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
    const { body, subject, leadId, clientRequestId } = await req.json();

    if (!body) {
      return NextResponse.json({ error: 'Reply body is required' }, { status: 400 });
    }

    if (!leadId) {
      return NextResponse.json({ error: 'Lead ID is required' }, { status: 400 });
    }

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
    const scope = await inboxScope(await getVisibleUserIds(user));
    const latest = await prisma.inboundMessage.findFirst({
      where: { tenantId: user.tenantId, leadId: lead.id, isBounce: false, AND: [scope.inbound] },
      orderBy: { date: 'desc' },
      select: { accountId: true },
    });
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
        threadKey,
        requestId: typeof clientRequestId === 'string' && clientRequestId ? clientRequestId : newRequestId(),
      },
      leadId: lead.id,
      accountId: account.id,
      to: lead.email,
      subject: replySubject,
      body,
      tenantId: user.tenantId,
    });

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
