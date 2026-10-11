import { NextRequest, NextResponse } from 'next/server';
import { mailboxRefusal, recipientRefusal } from '@/lib/email/sendGate';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead } from '@/lib/auth';
import { findSendableAccount } from '@/lib/email/sendableAccount';
import { finalizeComposed, prepareComposed } from '@/lib/email/prepareComposed';
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

  // Your own mailbox, or one of someone under you for a director / floor manager
  // (lib/email/sendableAccount.ts - the same rule the preview applies).
  const account = await findSendableAccount(user, tenantId, body.accountId);
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

  // CC/BCC suppression, the caller's own attachments within the cap, a sanitised HTML body with
  // pasted images turned into inline attachments (lib/email/prepareComposed.ts).
  const prepared = await prepareComposed({
    tenantId,
    userId: user.id,
    campaignId: leadCampaignId,
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    body: text,
    attachmentIds: body.attachmentIds,
  });
  if (!prepared.ok) return prepared.response;
  text = prepared.value.body;

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
      cc: prepared.value.cc,
      bcc: prepared.value.bcc,
      subject,
      body: text,
      tenantId,
    });

    // The files go on the message before it is queued, so the worker finds them.
    const attachFailure = await finalizeComposed(tenantId, user.id, outboundMessage.id, prepared.value);
    if (attachFailure) return attachFailure;

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
