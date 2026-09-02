import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/server/prisma";

// Attachment storage behind a backend seam. DB blob is the default (no infra); `storageBackend`
// + `storageRef` let a future move to local disk or S3 be a data migration only — no schema or
// send-path change. Reads dispatch on the backend; only DB is wired today, the others throw a clear
// "not configured" until implemented. All calls are tenant-scoped by the caller (Invariant 5).

export type AttachmentBackend = "DB" | "LOCAL" | "S3";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB/file — DB-blob guardrail
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

// Block obviously executable/script types; the common doc/image/archive set is allowed.
const BLOCKED_EXT = /\.(exe|dll|bat|cmd|com|scr|jar|msi|sh|ps1|vbs|vbe|wsf|hta|cpl)$/i;

export type StoredAttachment = {
  id: string;
  storageRef: string;
  storageBackend: AttachmentBackend;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

/** Persist bytes and return the staged attachment (messageId null until the send is created). */
export async function putAttachment(input: {
  organizationId: string;
  createdByUserId?: string | null;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<StoredAttachment> {
  const filename = input.filename.trim() || "attachment";
  if (BLOCKED_EXT.test(filename)) throw new Error("That file type is not allowed.");
  if (input.bytes.length === 0) throw new Error("The file is empty.");
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("File is too large (max 10 MB).");

  const id = `att_${randomBytes(10).toString("hex")}`;
  const row = await prisma.v2EmailAttachment.create({
    data: {
      id,
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId ?? null,
      filename: filename.slice(0, 255),
      mimeType: (input.mimeType || "application/octet-stream").slice(0, 180),
      sizeBytes: input.bytes.length,
      storageBackend: "DB",
      storageRef: id, // DB backend: the ref is the row's own id
      contentBytes: new Uint8Array(input.bytes),
    },
    select: { id: true, storageRef: true, storageBackend: true, filename: true, mimeType: true, sizeBytes: true },
  });
  return { ...row, storageBackend: row.storageBackend as AttachmentBackend };
}

/** Link previously-staged attachments to the outbound message at send-create time. Idempotent. */
export async function linkAttachmentsToMessage(
  organizationId: string,
  messageId: string,
  attachmentIds: string[]
): Promise<void> {
  const ids = Array.from(new Set(attachmentIds.filter(Boolean))).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  if (ids.length === 0) return;
  await prisma.v2EmailAttachment.updateMany({
    where: { organizationId, id: { in: ids }, messageId: null, deletedAt: null },
    data: { messageId },
  });
}

export type LoadedAttachment = { filename: string; mimeType: string; content: Buffer };

/** Load a message's attachment bytes for the MIME build at send time. */
export async function loadMessageAttachments(organizationId: string, messageId: string): Promise<LoadedAttachment[]> {
  const rows = await prisma.v2EmailAttachment.findMany({
    where: { organizationId, messageId, deletedAt: null },
    select: { filename: true, mimeType: true, storageBackend: true, contentBytes: true, storageRef: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ filename: r.filename, mimeType: r.mimeType, content: readBackendBytes(r) }));
}

function readBackendBytes(row: { storageBackend: string; contentBytes: Uint8Array | null; storageRef: string }): Buffer {
  if (row.storageBackend === "DB") {
    if (!row.contentBytes) throw new Error("Attachment bytes are missing for a DB-backed attachment.");
    return Buffer.from(row.contentBytes);
  }
  // LOCAL / S3 are the migration targets — implement a reader when that backend is configured.
  throw new Error(`Attachment backend "${row.storageBackend}" is not configured on this deployment.`);
}
