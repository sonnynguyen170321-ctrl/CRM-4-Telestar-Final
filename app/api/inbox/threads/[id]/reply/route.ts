import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
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
      select: { id: true, email: true, assignedToId: true },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Associated lead not found' }, { status: 404 });
    }

    // 2. Fetch the active email account for this lead's owner
    const account = await prisma.emailAccount.findFirst({
      where: { userId: lead.assignedToId, isActive: true },
    });

    if (!account) {
      return NextResponse.json({ error: 'No active email account connected for this user' }, { status: 400 });
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
