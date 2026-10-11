import { NextRequest, NextResponse } from 'next/server';
import { mailboxRefusal, recipientRefusal } from '@/lib/email/sendGate';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead, getVisibleUserIds } from '@/lib/auth';
import { canViewOwned } from '@/lib/visibility';
import type { SessionUser } from '@/lib/auth';
import { renderTemplate } from '@/lib/templates/render';
import { parseBody } from '@/lib/validation/core';
import { sendEmailSchema } from '@/lib/validation/schemas';
import { createOutboundMessage, enqueueEmailSendWorkflow } from '@/lib/workflows/email';
import { newRequestId } from '@/lib/email/idempotency';

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, sendEmailSchema, 'Invalid email send');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const tenantId = user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  }

  let leadCampaignId: string | null = null;

  if (body.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: body.leadId },
      select: { assignedToId: true, campaignId: true, tenantId: true },
    });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    if (!(await canAccessLead(user, lead))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    leadCampaignId = lead.campaignId;
  }

  // Suppression gate — check recipient email/domain against suppression entries
  const recipientBlocked = await recipientRefusal({ tenantId, email: body.to, campaignId: leadCampaignId });
  if (recipientBlocked) {
    return NextResponse.json({ error: recipientBlocked.error, code: recipientBlocked.code }, { status: recipientBlocked.status });
  }

  // Your own mailbox. A director or floor manager may also send from a mailbox of someone under
  // them — not, as before, from any mailbox in the company. A From line speaks for whoever
  // connected the mailbox, so this is not widened to team leads.
  const isManager = user.role === 'director' || user.role === 'floor_manager';
  const reach = isManager ? await getVisibleUserIds(user) : [user.id];
  const account = await prisma.emailAccount.findFirst({
    where: {
      id: body.accountId,
      tenantId,
      isActive: true,
      ...(reach === null ? {} : { userId: { in: reach.includes(user.id) ? reach : [...reach, user.id] } }),
    },
  });
  if (!account) {
    return NextResponse.json({ error: 'Email account not found' }, { status: 404 });
  }

  // Refuse a paused mailbox here, where the rep is still looking at the composer. The worker
  // already refuses it (`evaluateSendBlock`), but by then this route has answered 200, the
  // composer has said "queued" and the panel has said "sent" — and the message sits at `failed`
  // with a reason nobody in front of the screen was shown. Seen in the 2026-09-19 role-play: a
  // manager paused the inbox, the SDR sent anyway, and saw "Email sent".
  const mailboxBlocked = mailboxRefusal(account);
  if (mailboxBlocked) {
    return NextResponse.json({ error: mailboxBlocked.error, code: mailboxBlocked.code }, { status: mailboxBlocked.status });
  }

  // The From line speaks for whoever connected the mailbox, so the merge fields ({{sdrName}},
  // {{sdrTitle}}) are theirs, not the signed-in manager's.
  const sender = (await prisma.user.findFirst({
    where: { id: account.userId, tenantId },
    select: { firstName: true, lastName: true, role: true },
  })) ?? user;

  let subject: string = body.subject ?? '';
  let text: string = body.text ?? body.body ?? '';

  // Render merge fields with real lead and user data
  if (body.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: body.leadId } });
    if (lead) {
      if (body.templateId) {
        // Only a template the sender can see (lib/visibility.ts); otherwise this would read a
        // colleague's private copy out through the sent message.
        const found = await prisma.template.findUnique({ where: { id: body.templateId } });
        const template = found && (await canViewOwned(user, found)) ? found : null;
        if (template && !subject.trim() && !text.trim()) {
          subject = renderTemplate(template.subject ?? '', lead, sender);
          text = renderTemplate(template.body, lead, sender);
        } else {
          subject = renderTemplate(subject, lead, sender);
          text = renderTemplate(text, lead, sender);
        }
      } else {
        subject = renderTemplate(subject, lead, sender);
        text = renderTemplate(text, lead, sender);
      }
    }
  }

  if (!subject.trim()) {
    return NextResponse.json({ error: 'Subject cannot be empty' }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: 'Body cannot be empty' }, { status: 400 });
  }

  try {
    const outboundMessage = await createOutboundMessage({
      // Prefer the task: it is durable and shared with the sequence path, so completing
      // the same task twice resolves to one send. Otherwise this is an ad-hoc compose,
      // keyed on the client's request id.
      source: body.taskId
        ? { kind: 'task', taskId: body.taskId }
        : { kind: 'manual', requestId: body.clientRequestId ?? newRequestId() },
      leadId: body.leadId ?? 'unknown',
      accountId: body.accountId,
      templateId: body.templateId,
      to: body.to,
      subject,
      body: text,
      tenantId,
    });

    await enqueueEmailSendWorkflow(
      {
        outboundMessageId: outboundMessage.id,
        accountId: body.accountId,
        to: body.to,
        subject,
        body: text,
        leadId: body.leadId,
        templateId: body.templateId,
      },
      tenantId
    );

    return NextResponse.json({ success: true, outboundMessageId: outboundMessage.id });
  } catch (err) {
    console.error('[email/send] enqueue failed:', err);
    return NextResponse.json({ error: 'Failed to queue email' }, { status: 500 });
  }
}
