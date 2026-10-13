import { NextRequest, NextResponse } from 'next/server';
import { mailboxRefusal, recipientRefusal } from '@/lib/email/sendGate';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead } from '@/lib/auth';
import { findSendableAccount } from '@/lib/email/sendableAccount';
import { abandonOutbound, finalizeComposed, prepareComposed } from '@/lib/email/prepareComposed';
import { canViewOwned } from '@/lib/visibility';
import type { SessionUser } from '@/lib/auth';
import { renderSubject, renderTemplate } from '@/lib/templates/render';
import { loadRenderLead, loadRenderSender } from '@/lib/templates/renderContext';
import { parseBody } from '@/lib/validation/core';
import { sendEmailSchema } from '@/lib/validation/schemas';
import { createOutboundMessage, emailSendPayloadFor, enqueueTimedEmailSend } from '@/lib/workflows/email';
import { clearDraft, resolveComposerSendOptions, reviveCancelled } from '@/lib/email/composedSend';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';
import { newRequestId } from '@/lib/email/idempotency';
import { resolveComposerTask } from '@/lib/sequences/composerTask';
import type { SequenceStepRef } from '@/lib/sequences/stepOutcome';

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

  // A template the caller cannot see is not found - and is never passed on: the worker attaches a
  // template's files by id, so an unchecked id would carry a colleague's private attachments out.
  let template: Awaited<ReturnType<typeof prisma.template.findUnique>> = null;
  if (body.templateId) {
    const found = await prisma.template.findUnique({ where: { id: body.templateId } });
    template = found && found.tenantId === tenantId && (await canViewOwned(user, found)) ? found : null;
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
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

  // A send that belongs to a sequence task carries the step with it, so the task closes and the
  // cadence advances once the provider confirms - never on the click (lib/sequences/composerTask.ts).
  let stepRef: SequenceStepRef | null = null;
  let stepSequenceId: string | null = null;
  let stepOrder: number | null = null;
  if (body.taskId) {
    const composerTask = await resolveComposerTask(user, { taskId: body.taskId, leadId: body.leadId });
    if (!composerTask.ok) {
      return NextResponse.json(
        { error: composerTask.error, ...(composerTask.code ? { code: composerTask.code } : {}) },
        { status: composerTask.status }
      );
    }
    if (composerTask.ref && !body.leadId) {
      return NextResponse.json({ error: 'leadId is required to send for a sequence task' }, { status: 400 });
    }
    stepRef = composerTask.ref;
    stepSequenceId = composerTask.sequenceId;
    stepOrder = composerTask.stepOrder;
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
  const sender = (await loadRenderSender(tenantId, account.userId)) ?? user;

  let subject: string = body.subject ?? '';
  let text: string = body.text ?? body.body ?? '';

  // Render merge fields with real lead and user data
  if (body.leadId) {
    const leadRow = await prisma.lead.findUnique({ where: { id: body.leadId } });
    // The account, campaign and saved AI variables too: the same context the preview and the workers render with.
    const lead = leadRow ? await loadRenderLead(tenantId, leadRow) : null;
    if (lead) {
      if (body.templateId) {
        // Already checked above: only a template the sender can see (lib/visibility.ts).
        if (template && !subject.trim() && !text.trim()) {
          subject = renderSubject(template.subject ?? '', lead, sender);
          text = renderTemplate(template.body, lead, sender);
        } else {
          subject = renderSubject(subject, lead, sender);
          text = renderTemplate(text, lead, sender);
        }
      } else {
        subject = renderSubject(subject, lead, sender);
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

  // Schedule / undo window / tracking (lib/email/composedSend.ts); tracking not named takes the tenant default.
  const options = await resolveComposerSendOptions(tenantId, body);
  if (!options.ok) return options.response;
  const { timing, trackOpens, trackClicks } = options.value;

  const startedAt = Date.now();
  let created: Awaited<ReturnType<typeof createOutboundMessage>> | null = null;
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
      ...(stepRef ? { sequenceId: stepSequenceId, sequenceStepOrder: stepOrder } : {}),
      scheduledFor: timing.scheduledFor,
      composedById: user.id,
      trackOpens,
      trackClicks,
    });
    created = outboundMessage;

    // The rep took this one back (undo) and has written it again under the same key: it is theirs
    // to revive with the new content. Anyone else's cancelled message is not.
    let row = outboundMessage;
    let revived = false;
    if (row.status === OUTBOUND_STATUS.CANCELLED) {
      const back = await reviveCancelled(tenantId, user.id, row.id, {
        subject, body: text, cc: prepared.value.cc, bcc: prepared.value.bcc,
        scheduledFor: timing.scheduledFor, trackOpens, trackClicks,
      });
      if (!back) return NextResponse.json({ error: 'This email was cancelled. Start a new one.', code: 'cancelled' }, { status: 409 });
      row = back;
      revived = true;
    }

    // The files go on the message before it is queued, so the worker finds them. A failure here
    // makes the message terminal, so a send reported as failed cannot be swept up and sent later.
    const attachFailure = await finalizeComposed(tenantId, user.id, revived ? { ...row, createdAt: undefined } : outboundMessage, startedAt, prepared.value);
    if (attachFailure) return attachFailure;

    await enqueueTimedEmailSend(
      { ...emailSendPayloadFor(row), ...(stepRef ? { sequenceStepRef: stepRef } : {}) },
      tenantId,
      timing
    );
    if (body.leadId) await clearDraft(tenantId, user.id, `lead:${body.leadId}`);

    return NextResponse.json({
      success: true,
      outboundMessageId: outboundMessage.id,
      droppedCopies: prepared.value.droppedCopies,
      // The composer's toast: when it will go, and whether it can still be taken back.
      sendAt: timing.kind === 'scheduled' ? timing.scheduledFor : null,
      undoSeconds: timing.kind === 'undo' ? Math.round(timing.delayMs / 1000) : 0,
    });
  } catch (err) {
    console.error('[email/send] enqueue failed:', err);
    // Told it failed, so it must not go out later: terminal, unless this was a retry of an earlier send.
    if (created && created.createdAt && created.createdAt.getTime() >= startedAt) {
      await abandonOutbound(tenantId, created.id, 'Not sent: it could not be queued').catch(() => undefined);
    }
    return NextResponse.json({ error: 'Failed to queue email' }, { status: 500 });
  }
}
