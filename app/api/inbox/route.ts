import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';

function getThreadKey(subject: string | null): string {
  if (!subject) return 'no-subject';
  return subject
    .toLowerCase()
    .replace(/^(re|fwd|fw):\s*/gi, '')
    .trim();
}

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // Guard: without a tenant, Prisma would drop the tenant filter and leak cross-tenant mail.
  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const folder = searchParams.get('folder') || 'inbox'; // inbox, sent, spam, trash

  try {
    // 1. Fetch Inbound & Outbound messages
    const inbound = await prisma.inboundMessage.findMany({
      where: {
        tenantId: user.tenantId,
        ...(folder === 'spam' ? { isSpam: true, isTrash: false } : {}),
        ...(folder === 'trash' ? { isTrash: true } : {}),
        ...(folder === 'inbox' ? { isSpam: false, isTrash: false } : {}),
      },
      include: {
        lead: {
          select: { id: true, firstName: true, lastName: true, company: true, operatingState: true },
        },
      },
      orderBy: { date: 'desc' },
    });

    // Sent must include the sends that did *not* work.
    //
    // This filtered on `status: 'sent'` alone, which made every delivery failure invisible to the
    // person who wrote the mail: the composer says "queued", the message never appears here, no
    // activity is written against the lead, and the row recording the provider's rejection is
    // readable only by a director on /admin/outbound. A rep had no way to learn that a send
    // failed, and so kept waiting for a reply to a mail that never left.
    //
    // `pending` and `sending` stay out on purpose — those are in flight, and a message enqueued
    // two seconds ago is not yet news. Anything genuinely stuck in `sending` is swept to
    // `reconciliation_required` by the maintenance worker and appears then.
    const outbound = await prisma.outboundMessage.findMany({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [
            OUTBOUND_STATUS.SENT,
            OUTBOUND_STATUS.FAILED,
            OUTBOUND_STATUS.RECONCILIATION_REQUIRED,
            OUTBOUND_STATUS.PERMANENTLY_FAILED,
          ],
        },
      },
      include: {
        lead: {
          select: { id: true, firstName: true, lastName: true, company: true, operatingState: true },
        },
        account: {
          select: { email: true },
        },
      },
      // createdAt, not sentAt: a message that never sent has no sentAt, and ordering by a null
      // column would group every failure at one end instead of in the timeline where it belongs.
      orderBy: { createdAt: 'desc' },
    });

    // 2. Map messages into a unified format
    const unifiedMessages: any[] = [
      ...inbound.map((msg) => ({
        id: msg.id,
        type: 'inbound' as const,
        fromEmail: msg.fromEmail,
        fromName: msg.fromName,
        to: msg.to,
        subject: msg.subject,
        body: msg.body,
        bodyHtml: msg.bodyHtml,
        providerMessageId: msg.providerMessageId,
        date: msg.date,
        isRead: msg.isRead,
        isSpam: msg.isSpam,
        isTrash: msg.isTrash,
        replyClass: msg.replyClass,
        replyKind: msg.replyKind,
        replyConfidence: msg.replyConfidence,
        classificationSource: msg.classificationSource,
        lead: msg.lead,
      })),
      ...outbound.map((msg) => ({
        id: msg.id,
        type: 'outbound' as const,
        fromEmail: msg.account?.email || 'me',
        fromName: 'Me',
        to: msg.to,
        subject: msg.subject,
        body: msg.body,
        bodyHtml: msg.body || '',
        providerMessageId: msg.providerMessageId,
        date: msg.sentAt || msg.createdAt,
        isRead: true,
        isSpam: false,
        isTrash: false,
        lead: msg.lead,
        // Added fields, not changed ones: a client that does not read them renders exactly what
        // it rendered before. `deliveryStatus` is what lets the thread mark a message as failed
        // rather than showing it indistinguishably from one that arrived.
        deliveryStatus: msg.status,
        deliveryError: msg.status === OUTBOUND_STATUS.SENT ? null : msg.errorMessage,
      })),
    ];

    // 3. Group messages into threads by simplified subject + leadId
    const threadMap = new Map<string, {
      id: string;
      subject: string;
      lead: any;
      messages: any[];
      latestMessageAt: Date;
      isRead: boolean;
      folder: string;
    }>();

    for (const msg of unifiedMessages) {
      const threadKey = `${msg.lead?.id || 'no-lead'}-${getThreadKey(msg.subject)}`;
      const existing = threadMap.get(threadKey);

      if (existing) {
        existing.messages.push(msg);
        if (msg.date > existing.latestMessageAt) {
          existing.latestMessageAt = msg.date;
          // Set thread subject to the latest one
          existing.subject = msg.subject || existing.subject;
        }
        if (msg.type === 'inbound' && !msg.isRead) {
          existing.isRead = false;
        }
      } else {
        threadMap.set(threadKey, {
          id: threadKey,
          subject: msg.subject || '(No Subject)',
          lead: msg.lead,
          messages: [msg],
          latestMessageAt: msg.date,
          isRead: msg.type === 'inbound' ? msg.isRead : true,
          folder: msg.type === 'outbound' ? 'sent' : msg.isSpam ? 'spam' : msg.isTrash ? 'trash' : 'inbox',
        });
      }
    }

    // 4. Sort messages inside each thread chronologically (oldest to newest)
    // and construct the final list of threads
    const threads = Array.from(threadMap.values())
      .map((thread) => {
        thread.messages.sort((a, b) => a.date.getTime() - b.date.getTime());
        return thread;
      })
      .filter((thread) => {
        // Filter threads based on selected folder
        if (folder === 'inbox') {
          // Inbox shows threads that contain inbound messages (not spam, not trash)
          return thread.messages.some((m) => m.type === 'inbound' && !m.isSpam && !m.isTrash);
        }
        if (folder === 'sent') {
          // Sent shows threads containing outbound messages
          return thread.messages.some((m) => m.type === 'outbound');
        }
        if (folder === 'spam') {
          return thread.messages.some((m) => m.type === 'inbound' && m.isSpam && !m.isTrash);
        }
        if (folder === 'trash') {
          return thread.messages.some((m) => m.type === 'inbound' && m.isTrash);
        }
        return true;
      })
      .sort((a, b) => b.latestMessageAt.getTime() - a.latestMessageAt.getTime());

    return NextResponse.json(threads);
  } catch (error) {
    console.error('[inbox-get] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // Guard: without a tenant, Prisma would drop the tenant filter and mutate cross-tenant mail.
  if (!user.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const { messageIds, action } = await req.json(); // action: read, unread, spam, trash, delete

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json({ error: 'messageIds must be a non-empty array' }, { status: 400 });
    }

    if (action === 'read') {
      await prisma.inboundMessage.updateMany({
        where: { id: { in: messageIds }, tenantId: user.tenantId },
        data: { isRead: true },
      });
    } else if (action === 'unread') {
      await prisma.inboundMessage.updateMany({
        where: { id: { in: messageIds }, tenantId: user.tenantId },
        data: { isRead: false },
      });
    } else if (action === 'spam') {
      await prisma.inboundMessage.updateMany({
        where: { id: { in: messageIds }, tenantId: user.tenantId },
        data: { isSpam: true, isTrash: false },
      });
    } else if (action === 'trash') {
      await prisma.inboundMessage.updateMany({
        where: { id: { in: messageIds }, tenantId: user.tenantId },
        data: { isTrash: true },
      });
    } else if (action === 'delete') {
      await prisma.inboundMessage.deleteMany({
        where: { id: { in: messageIds }, tenantId: user.tenantId },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[inbox-patch] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
