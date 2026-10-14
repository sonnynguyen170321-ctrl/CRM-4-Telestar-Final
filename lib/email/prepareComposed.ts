/**
 * The checks and transforms every composed email (one-off send, inbox reply) goes through, in one
 * place so the two routes cannot drift apart:
 *
 *   1. CC / BCC: normalised, then each address put through the same last gates as the main
 *      recipient (suppression and bounce evidence). A copy that fails is dropped and reported -
 *      the rep is told, the email to the main recipient is not held up by it;
 *   2. attachments: only the caller's own uploads, within the allowlist and the 10 MB cap;
 *   3. body: HTML is sanitised, a blank draft is refused, pasted images become inline attachments.
 *
 * `prepareComposed` writes nothing. `finalizeComposed` attaches the files once the OutboundMessage
 * exists and, if that fails, makes the message terminal - a send the rep was told failed must not be
 * picked up later by the maintenance sweep and go out without its attachments.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isHtml } from '@/lib/email/sanitize';
import { composeHtmlShapeProblem, isHtmlBlank, sanitizeComposeHtml } from '@/lib/compose/html';
import { normalizeCopyRecipients } from '@/lib/compose/recipients';
import { recipientRefusal } from '@/lib/email/sendGate';
import { blockIfBounced } from '@/lib/email/suppress';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';
import {
  bindComposeAttachments,
  inlineImagesForBody,
  resolveComposeAttachments,
  storeInlineImages,
  type ComposeAttachmentRow,
} from '@/lib/email/composeAttachments';
import type { InlineImage } from '@/lib/compose/attachmentPolicy';

export interface DroppedCopy {
  address: string;
  reason: string;
}

export interface PreparedComposed {
  cc: string[];
  bcc: string[];
  /** Copies left off because the address is suppressed or has bounced; shown to the rep. */
  droppedCopies: DroppedCopy[];
  body: string;
  attachmentRows: ComposeAttachmentRow[];
  inlineImages: InlineImage[];
}

/** Why a copy address may not be sent to, or null. Mirrors the worker's gates for the main recipient. */
async function copyRefusalReason(tenantId: string, userId: string, address: string, campaignId: string | null): Promise<string | null> {
  const refusal = await recipientRefusal({ tenantId, email: address, campaignId });
  if (refusal) return 'is on the do-not-contact list';
  // A bounced address is suppressed on the spot (no lead is named: a bounce on a copy must not
  // pause the main recipient's cadences).
  const bounced = await blockIfBounced({ tenantId, email: address, leadId: null, actorUserId: userId });
  return bounced ? 'bounced earlier' : null;
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

  const normalized = normalizeCopyRecipients(input.to, input.cc, input.bcc);
  const droppedCopies: DroppedCopy[] = [];
  const keep = async (addresses: string[]) => {
    const kept: string[] = [];
    for (const address of addresses) {
      const reason = await copyRefusalReason(input.tenantId, input.userId, address, input.campaignId);
      if (reason) droppedCopies.push({ address, reason }); else kept.push(address);
    }
    return kept;
  };
  const cc = await keep(normalized.cc);
  const bcc = await keep(normalized.bcc);

  const attachments = await resolveComposeAttachments(input.tenantId, input.userId, input.attachmentIds);
  if (!attachments.ok) return fail(attachments.refusal.status, attachments.refusal.error);

  let body = input.body;
  let inlineImages: InlineImage[] = [];
  if (isHtml(body)) {
    // HTML too large or too deep to sanitise is refused, never queued unsanitised.
    const problem = composeHtmlShapeProblem(body);
    if (problem) return fail(413, problem, 'body_too_complex');
    body = sanitizeComposeHtml(body);
    if (isHtmlBlank(body)) return fail(400, 'Body cannot be empty');
    const inline = inlineImagesForBody(body);
    body = inline.html;
    inlineImages = inline.images;
  }
  if (!body.trim()) return fail(400, 'Body cannot be empty');

  return { ok: true, value: { cc, bcc, droppedCopies, body, attachmentRows: attachments.rows, inlineImages } };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Make a message the rep was told failed unable to send: terminal, with the reason. Only for a row
 * this request created and nothing has claimed (`pending`); a retried request must never cancel an
 * earlier, legitimate send.
 */
export async function abandonOutbound(tenantId: string, outboundMessageId: string, reason: string): Promise<void> {
  await prisma.outboundMessage.updateMany({
    where: { id: outboundMessageId, tenantId, status: OUTBOUND_STATUS.PENDING },
    data: { status: OUTBOUND_STATUS.PERMANENTLY_FAILED, errorMessage: reason },
  });
}

interface FinalizeTarget {
  id: string;
  /** Absent only on the stand-ins some unit tests use; such a row counts as this request's own. */
  createdAt?: Date;
  cc?: string[];
  bcc?: string[];
}

/**
 * Attach the uploads and the pasted images to the message that now exists. Null when fine.
 *
 * `startedAt` is when this request began: a row created after it is this request's own, a row
 * created before it is an idempotent retry of an earlier one. A retry that arrives with different
 * recipients or files than the first attempt is refused (409) instead of silently answering for
 * the first attempt's content. A failure on a row this request created makes the row terminal.
 */
export async function finalizeComposed(
  tenantId: string,
  userId: string,
  outbound: FinalizeTarget,
  startedAt: number,
  prepared: PreparedComposed,
): Promise<NextResponse | null> {
  const createdNow = !outbound.createdAt || outbound.createdAt.getTime() >= startedAt;
  const refuse = async (status: number, error: string) => {
    if (createdNow) await abandonOutbound(tenantId, outbound.id, `Not sent: ${error}`).catch(() => undefined);
    return NextResponse.json({ error }, { status });
  };

  try {
    if (!createdNow) {
      const sent = await prisma.attachment.findMany({
        where: { tenantId, outboundMessageId: outbound.id, cid: null },
        select: { id: true },
      });
      const unchanged =
        sameSet(outbound.cc ?? [], prepared.cc) &&
        sameSet(outbound.bcc ?? [], prepared.bcc) &&
        sameSet(sent.map((a) => a.id), prepared.attachmentRows.map((a) => a.id));
      if (!unchanged) {
        return NextResponse.json(
          { error: 'This email was already sent once with different recipients or attachments. Close the composer and start a new one.', code: 'changed' },
          { status: 409 },
        );
      }
    }
    const conflict = await bindComposeAttachments(tenantId, userId, outbound.id, prepared.attachmentRows);
    if (conflict) return await refuse(conflict.status, conflict.error);
    await storeInlineImages(tenantId, userId, outbound.id, prepared.inlineImages);
    return null;
  } catch (err) {
    console.error('[compose] could not attach files to the message:', err);
    return refuse(500, 'The attachments could not be saved, so the email was not sent. Try again.');
  }
}
