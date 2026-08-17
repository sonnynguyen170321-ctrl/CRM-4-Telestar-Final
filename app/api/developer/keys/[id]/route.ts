import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/developer/keys/[id]
 * Revoke and remove an API key immediately.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
  }

  const tenantId = user.tenantId!;
  const existing = await prisma.apiKey.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  await tenantStorage.run({ tenantId }, () =>
    prisma.apiKey.delete({
      where: { id },
    })
  );

  return NextResponse.json({ success: true, message: 'API key revoked successfully' });
}
