import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead } from '@/lib/auth';
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
  const recipientDomain = body.to.split('@')[1];
  const suppressed = await prisma.suppressionEntry.findFirst({
    where: {
      tenantId,
      AND: [
        { OR: [{ email: body.to }, { domain: recipientDomain }] },
        { OR: [{ campaignId: leadCampaignId }, { campaignId: null }] },
      ],
    },
  });
  if (suppressed) {
    return NextResponse.json({ error: 'Recipient is suppressed' }, { status: 403 });
  }

  const isManager = user.role === 'director' || user.role === 'floor_manager';
  const account = await prisma.emailAccount.findFirst({
    where: {
      id: body.accountId,
      tenantId,
      isActive: true,
      ...(isManager ? {} : { userId: user.id }),
    },
  });
  if (!account) {
    return NextResponse.json({ error: 'Email account not found' }, { status: 404 });
  }

  let subject: string = body.subject ?? '';
  let text: string = body.text ?? body.body ?? '';

  // Render merge fields with real lead and user data
  if (body.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: body.leadId } });
    if (lead) {
      if (body.templateId) {
        const template = await prisma.template.findUnique({ where: { id: body.templateId } });
        if (template && !subject.trim() && !text.trim()) {
          subject = renderTemplate(template.subject ?? '', lead, user);
          text = renderTemplate(template.body, lead, user);
        } else {
          subject = renderTemplate(subject, lead, user);
          text = renderTemplate(text, lead, user);
        }
      } else {
        subject = renderTemplate(subject, lead, user);
        text = renderTemplate(text, lead, user);
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
