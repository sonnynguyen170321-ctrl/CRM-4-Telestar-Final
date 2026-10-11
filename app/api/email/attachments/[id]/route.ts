import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

/** Remove an upload the caller made and has not sent. A sent email's files are never deleted here. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });

  const { id } = await params;
  const removed = await prisma.attachment.deleteMany({
    where: { id, tenantId: user.tenantId, uploadedById: user.id, templateId: null, outboundMessageId: null },
  });
  // Someone else's, already sent, or a template's: all "not found" - the caller learns nothing.
  if (removed.count === 0) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
