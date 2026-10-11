/**
 * The checks and transforms every composed email (one-off send, inbox reply) goes through before
 * it is queued, in one place so the two routes cannot drift apart:
 *
 *   1. CC / BCC: normalised, and each address checked against suppression like the main recipient;
 *   2. attachments: only the caller's own uploads, within the allowlist and the 10 MB cap;
 *   3. body: HTML is sanitised, a blank draft is refused, pasted images become inline attachments.
 *
 * Nothing here writes; `finalizeComposed` attaches the files once the OutboundMessage exists.
 */
import { NextResponse } from 'next/server';
import { isHtml } from '@/lib/email/sanitize';
import { isHtmlBlank, sanitizeComposeHtml } from '@/lib/compose/html';
import { normalizeCopyRecipients } from '@/lib/compose/recipients';
import { recipientRefusal } from '@/lib/email/sendGate';
import {
  bindComposeAttachments,
  inlineImagesForBody,
  resolveComposeAttachments,
  storeInlineImages,
  type ComposeAttachmentRow,
} from '@/lib/email/composeAttachments';
import type { InlineImage } from '@/lib/compose/attachmentPolicy';

export interface PreparedComposed {
  cc: string[];
  bcc: string[];
  body: string;
  attachmentRows: ComposeAttachmentRow[];
  inlineImages: InlineImage[];
}

export async function prepareComposed(input: {
  tenantId: string;
  userId: string;
  campaignId: string | null;
  to: string;
  cc?: string[];
  bcc?: string[];
  body: string;
  attachmentIds?: string[];
}): Promise<{ ok: true; value: PreparedComposed } | { ok: false; response: NextResponse }> {
  const fail = (status: number, error: string, code?: string) => ({
    ok: false as const,
    response: NextResponse.json(code ? { error, code } : { error }, { status }),
  });

  const { cc, bcc } = normalizeCopyRecipients(input.to, input.cc, input.bcc);
  for (const address of [...cc, ...bcc]) {
    const refusal = await recipientRefusal({ tenantId: input.tenantId, email: address, campaignId: input.campaignId });
    if (refusal) return fail(refusal.status, `${address}: ${refusal.error}`, refusal.code);
  }

  const attachments = await resolveComposeAttachments(input.tenantId, input.userId, input.attachmentIds);
  if (!attachments.ok) return fail(attachments.refusal.status, attachments.refusal.error);

  let body = input.body;
  let inlineImages: InlineImage[] = [];
  if (isHtml(body)) {
    body = sanitizeComposeHtml(body);
    if (isHtmlBlank(body)) return fail(400, 'Body cannot be empty');
    const inline = inlineImagesForBody(body);
    body = inline.html;
    inlineImages = inline.images;
  }
  if (!body.trim()) return fail(400, 'Body cannot be empty');

  return { ok: true, value: { cc, bcc, body, attachmentRows: attachments.rows, inlineImages } };
}

/** Attach the uploads and the pasted images to the message that now exists. Null when fine. */
export async function finalizeComposed(
  tenantId: string,
  userId: string,
  outboundMessageId: string,
  prepared: PreparedComposed,
): Promise<NextResponse | null> {
  const conflict = await bindComposeAttachments(tenantId, userId, outboundMessageId, prepared.attachmentRows);
  if (conflict) return NextResponse.json({ error: conflict.error }, { status: conflict.status });
  await storeInlineImages(tenantId, userId, outboundMessageId, prepared.inlineImages);
  return null;
}
