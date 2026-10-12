/**
 * Ad-hoc attachments of a composed email (the one-off composer and the inbox reply).
 *
 * They live in the same `Attachment` table as template attachments, with `templateId` null:
 *
 *   upload  -> a row with `uploadedById = the rep`, `outboundMessageId = null`
 *   send    -> the send route binds the rows to the OutboundMessage it creates
 *   worker  -> reads the rows by `outboundMessageId` and attaches them, like template attachments
 *
 * Every step is scoped by the session's tenant, and only the uploader can attach an unbound row,
 * so one rep (or one tenant) can never put another's file on an email. Type, size and the total
 * cap are checked here, on the server; the composer's checks are only a courtesy.
 */
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_TOTAL_BYTES,
  extractInlineImages,
  formatBytes,
} from '@/lib/compose/attachmentPolicy';
import { MAX_INLINE_IMAGE_BYTES } from '@/lib/compose/urls';

export type AttachmentRefusal = { status: number; error: string };

export interface ComposeAttachmentRow {
  id: string;
  name: string;
  sizeBytes: number;
  outboundMessageId: string | null;
}

/** Unbound uploads older than this are removed the next time the same rep uploads. */
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The rows `ids` names, if the caller may attach all of them and they fit the cap; otherwise the
 * refusal to answer with. An id that is missing, in another tenant, uploaded by someone else, or
 * a template's attachment all read as "not found" — the caller learns nothing about them.
 */
export async function resolveComposeAttachments(
  tenantId: string,
  userId: string,
  ids: readonly string[] | undefined,
): Promise<{ ok: true; rows: ComposeAttachmentRow[] } | { ok: false; refusal: AttachmentRefusal }> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return { ok: true, rows: [] };
  if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, refusal: { status: 400, error: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per email` } };
  }
  const rows = await prisma.attachment.findMany({
    where: { id: { in: unique }, tenantId, uploadedById: userId, templateId: null },
    select: { id: true, name: true, sizeBytes: true, outboundMessageId: true },
  });
  if (rows.length !== unique.length) {
    return { ok: false, refusal: { status: 400, error: 'An attachment is no longer available. Remove it and attach the file again.' } };
  }
  const total = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
    return { ok: false, refusal: { status: 413, error: `Attachments are ${formatBytes(total)}; the limit is ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)} per email` } };
  }
  return { ok: true, rows };
}

/**
 * Attach the resolved rows to the message. Rows already on this message (a retried request) are
 * left; a row bound to a different message is a conflict, not silently moved.
 */
export async function bindComposeAttachments(
  tenantId: string,
  userId: string,
  outboundMessageId: string,
  rows: readonly ComposeAttachmentRow[],
): Promise<AttachmentRefusal | null> {
  if (rows.some((row) => row.outboundMessageId && row.outboundMessageId !== outboundMessageId)) {
    return { status: 409, error: 'An attachment was already sent with another email' };
  }
  const unbound = rows.filter((row) => !row.outboundMessageId).map((row) => row.id);
  if (unbound.length > 0) {
    await prisma.attachment.updateMany({
      where: { id: { in: unbound }, tenantId, uploadedById: userId, outboundMessageId: null },
      data: { outboundMessageId },
    });
  }
  return null;
}

/**
 * Store the images pasted into the body as inline attachments of the message and rewrite their
 * `src` to `cid:`. Returns the body to queue. Idempotent: a retried request finds the rows by
 * their content-derived ids and does not store them twice.
 */
export function inlineImagesForBody(html: string): ReturnType<typeof extractInlineImages> {
  return extractInlineImages(
    html,
    (bytes) => `cmp-${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}@telestar`,
    MAX_INLINE_IMAGE_BYTES,
  );
}

export async function storeInlineImages(
  tenantId: string,
  userId: string,
  outboundMessageId: string,
  images: ReturnType<typeof extractInlineImages>['images'],
): Promise<void> {
  if (images.length === 0) return;
  const existing = await prisma.attachment.findMany({
    where: { tenantId, outboundMessageId, cid: { in: images.map((image) => image.cid) } },
    select: { cid: true },
  });
  const have = new Set(existing.map((row) => row.cid));
  for (const image of images) {
    if (have.has(image.cid)) continue;
    const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.split('/')[1];
    // The unique (outboundMessageId, cid) index makes a concurrent duplicate harmless: the loser's
    // insert fails and the image is already there.
    await prisma.attachment.create({
      data: {
        tenantId,
        uploadedById: userId,
        outboundMessageId,
        cid: image.cid,
        name: `image-${image.cid.slice(4, 12)}.${extension}`,
        contentType: image.contentType,
        content: image.bytes.toString('base64'),
        sizeBytes: image.bytes.length,
      },
    }).catch((err: { code?: string }) => {
      if (err?.code !== 'P2002') throw err;
    });
  }
}

/** Remove this rep's abandoned uploads (never attached to a message) older than a day. */
export async function removeStaleUploads(tenantId: string, userId: string): Promise<void> {
  await prisma.attachment.deleteMany({
    where: {
      tenantId,
      uploadedById: userId,
      templateId: null,
      outboundMessageId: null,
      createdAt: { lt: new Date(Date.now() - ORPHAN_TTL_MS) },
    },
  });
}
