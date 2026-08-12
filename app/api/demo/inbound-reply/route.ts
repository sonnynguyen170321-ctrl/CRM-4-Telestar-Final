import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { handleApplyReply } from '@/workers/sync';

/**
 * Deliver a controlled inbound reply during the demo.
 *
 * It is **not** a second inbound listener: it persists an `InboundMessage` exactly as
 * `handleEmailSync` would, then calls the same `handleApplyReply` chokepoint. Classification,
 * pausing and handoff all run through the real path, so what the audience sees is the production
 * behaviour rather than a staged animation.
 *
 * Restricted to the demo tenant, so it cannot be used to inject mail into a real one.
 */
const DEMO_TENANT_ID = 'demo-telestar';

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (user.tenantId !== DEMO_TENANT_ID) {
    return NextResponse.json({ error: 'Available in the demo tenant only' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const leadId = String(body.leadId ?? '');
    const text = String(body.body ?? '');
    const subject = String(body.subject ?? 'Re: your email');
    const autoReply = Boolean(body.autoReply);
    if (!leadId || !text) {
      return NextResponse.json({ error: 'leadId and body are required' }, { status: 400 });
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, tenantId: true, email: true, assignedToId: true },
    });
    if (!lead || lead.tenantId !== DEMO_TENANT_ID) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }

    const account = await prisma.emailAccount.findFirst({
      where: { tenantId: DEMO_TENANT_ID, userId: lead.assignedToId },
      select: { id: true, email: true },
    });
    if (!account) return NextResponse.json({ error: 'No demo mailbox' }, { status: 400 });

    const providerMessageId = `demo-inbound-${randomUUID()}`;
    await prisma.inboundMessage.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        accountId: account.id,
        leadId: lead.id,
        fromEmail: lead.email,
        to: account.email,
        subject,
        body: text,
        bodyHtml: text,
        providerMessageId,
        date: new Date(),
        // An auto-responder is stored as not-a-reply so reply rate stays honest, exactly as sync
        // would have stored it.
        isReply: !autoReply,
      },
    });

    const result = await handleApplyReply({
      providerMessageId,
      leadId: lead.id,
      accountId: account.id,
      autoReply,
    });

    return NextResponse.json({ providerMessageId, ...result });
  } catch (err) {
    return handleApiError('api/demo/inbound-reply POST', err);
  }
}
