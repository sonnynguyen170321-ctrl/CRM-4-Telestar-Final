import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { canAccessLead, requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { findSendableAccount } from '@/lib/email/sendableAccount';
import { mailboxRefusal } from '@/lib/email/sendGate';
import { EmailService } from '@/lib/email/EmailService';
import { effectiveDryRun, isCanaryRecipientAllowed, isGlobalEmailPaused } from '@/lib/emailSafety';
import { renderSubject, renderTemplate } from '@/lib/templates/render';
import { loadRenderLead, loadRenderSender } from '@/lib/templates/renderContext';
import { isHtml } from '@/lib/email/sanitize';
import { sanitizeComposeHtml, unchipifyMergeTags } from '@/lib/compose/html';
import { composeEmailBody } from '@/lib/email/signature';
import { composeRateLimit } from '@/lib/compose/rateLimit';
import { composeAttachmentIds } from '@/lib/validation/schemas';
import { id, longText } from '@/lib/validation/core';

const schema = z.object({
  leadId: id,
  accountId: id,
  subject: z.string().min(1).max(998),
  body: longText.min(1),
  attachmentIds: composeAttachmentIds.optional(),
});

/**
 * "Send a test to myself": the email rendered with the real lead's variables, sent from the chosen
 * mailbox to the signed-in user's own address - and nothing else. It is deliberately not an
 * OutboundMessage: no lead activity, no lastContactedAt, no sequence step, no quota slot, no
 * suppression row, no tracking pixel and no rewritten links. The recipient is always the session
 * user's own email, never a client-supplied address, so this cannot be used to mail a third party.
 * Rate limited per user; honours the global pause, dry-run and canary restrictions like a real send.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  const tenantId = user.tenantId;
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid test send' }, { status: 400 });
  const input = parsed.data;
  const limited = await composeRateLimit('testSend', user.id);
  if (limited) return limited;

  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, tenantId } });
  if (!lead || !(await canAccessLead(user, lead))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  const account = await findSendableAccount(user, tenantId, input.accountId);
  if (!account) return NextResponse.json({ error: 'Email account not found' }, { status: 404 });
  const refusal = mailboxRefusal(account);
  if (refusal) return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status });

  const to = user.email;
  if (!to) return NextResponse.json({ error: 'Your account has no email address to send the test to' }, { status: 400 });
  if (isGlobalEmailPaused()) return NextResponse.json({ error: 'Sending is paused for the whole system right now.', code: 'global_pause' }, { status: 409 });
  const dryRun = effectiveDryRun(tenantId);
  if (!dryRun && !isCanaryRecipientAllowed(to)) {
    return NextResponse.json({ error: 'Sending to this address is switched off right now.', code: 'canary' }, { status: 409 });
  }

  // Rendered exactly as the worker renders the real thing (final pass, sender = the mailbox owner).
  const sender = (await loadRenderSender(tenantId, account.userId)) ?? user;
  const renderLead = await loadRenderLead(tenantId, lead);
  const subject = renderSubject(unchipifyMergeTags(input.subject), renderLead, sender, { final: true });
  let body = renderTemplate(unchipifyMergeTags(input.body), renderLead, sender, { final: true });
  if (isHtml(body)) body = sanitizeComposeHtml(body);

  if (dryRun) return NextResponse.json({ success: true, dryRun: true, to });

  const files = input.attachmentIds?.length
    ? await prisma.attachment.findMany({
        where: { id: { in: input.attachmentIds }, tenantId, uploadedById: user.id, cid: null },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const composed = composeEmailBody(body, isHtml(body), account.signature, account.signatureImages);
  try {
    const service = await EmailService.fromAccount(account);
    await service.send({
      from: account.email,
      fromName: account.fromName,
      to,
      subject: `[Test] ${subject}`,
      text: composed.text,
      html: composed.html,
      attachments: [
        ...files.map((file) => ({ filename: file.name, content: Buffer.from(file.content, 'base64'), contentType: file.contentType })),
        ...composed.attachments,
      ],
    });
  } catch (err) {
    console.error('[email/test-send] provider refused the test:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'The mail provider did not accept the test email. Check the mailbox in Settings.' }, { status: 502 });
  }
  return NextResponse.json({ success: true, to });
}
