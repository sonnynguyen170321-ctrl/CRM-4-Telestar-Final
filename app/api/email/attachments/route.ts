import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { checkAttachmentFile, formatBytes, MAX_UNBOUND_BYTES_PER_USER, MAX_UPLOAD_BODY_BYTES } from '@/lib/compose/attachmentPolicy';
import { composeRateLimit } from '@/lib/compose/rateLimit';
import { removeStaleUploads } from '@/lib/email/composeAttachments';
import { BodyTooLargeError, readCappedBody } from '@/lib/http/readCappedBody';

/**
 * Upload one file for the email being composed. The file is stored unbound (`outboundMessageId`
 * null, `uploadedById` = the caller) and only the caller can attach it to a message; the send
 * routes bind it. Type is decided by the extension and the file's contents (lib/compose/
 * attachmentPolicy.ts), never by the browser's content type; the 10 MB total per message is
 * enforced again at send.
 *
 * The body is read as a stream with a byte cap, so a chunked or understated upload is cut off
 * while it arrives instead of being buffered whole.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });

  const limited = await composeRateLimit('upload', user.id);
  if (limited) return limited;

  let file: File | null = null;
  try {
    const raw = await readCappedBody(req, MAX_UPLOAD_BODY_BYTES);
    const contentType = req.headers.get('content-type');
    if (!contentType || !/^multipart\/form-data/i.test(contentType)) {
      return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
    }
    const form = await new Request(req.url, { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(raw) }).formData();
    const entry = form.get('file');
    file = entry instanceof File ? entry : null;
  } catch (err) {
    if (err instanceof BodyTooLargeError) return NextResponse.json({ error: 'File is larger than 10 MB' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const checked = checkAttachmentFile(file.name, bytes);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  try {
    await removeStaleUploads(user.tenantId, user.id);
    // What this rep has uploaded and not sent. Bounded, so unsent files cannot pile up in the
    // database between sweeps.
    const pending = await prisma.attachment.aggregate({
      where: { tenantId: user.tenantId, uploadedById: user.id, templateId: null, outboundMessageId: null },
      _sum: { sizeBytes: true },
    });
    if ((pending._sum.sizeBytes ?? 0) + bytes.length > MAX_UNBOUND_BYTES_PER_USER) {
      return NextResponse.json(
        { error: `You have ${formatBytes(pending._sum.sizeBytes ?? 0)} of unsent attachments. Remove some before adding more.` },
        { status: 413 },
      );
    }
    const attachment = await prisma.attachment.create({
      data: {
        tenantId: user.tenantId,
        uploadedById: user.id,
        name: checked.name,
        contentType: checked.contentType,
        content: bytes.toString('base64'),
        sizeBytes: bytes.length,
      },
      select: { id: true, name: true, contentType: true, sizeBytes: true },
    });
    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    console.error('[email-attachments] upload failed:', error);
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 });
  }
}
