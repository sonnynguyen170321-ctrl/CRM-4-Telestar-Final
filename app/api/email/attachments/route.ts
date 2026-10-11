import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { checkAttachmentFile, MAX_ATTACHMENT_FILE_BYTES } from '@/lib/compose/attachmentPolicy';
import { removeStaleUploads } from '@/lib/email/composeAttachments';

/**
 * Upload one file for the email being composed. The file is stored unbound (`outboundMessageId`
 * null, `uploadedById` = the caller) and only the caller can attach it to a message; the send
 * routes bind it. Type is decided by the extension and the file's first bytes, never by the
 * browser's content type; the 10 MB total per message is enforced again at send.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });

  // Cheap reject before the body is buffered.
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_ATTACHMENT_FILE_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'File is larger than 10 MB' }, { status: 413 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get('file');
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const checked = checkAttachmentFile(file.name, bytes);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  try {
    await removeStaleUploads(user.tenantId, user.id);
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
