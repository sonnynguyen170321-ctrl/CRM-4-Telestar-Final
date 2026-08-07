import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, canAccessUser, clearVisibleUserCache } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { logAdminAudit } from '@/lib/audit';
import { handleApiError, notFound } from '@/lib/api/errors';

/**
 * Sign a user out of every device.
 *
 * Sessions are stateless JWTs with no server-side store, so there is nothing to delete —
 * revocation works by bumping `User.authVersion`, which `getSessionUser` compares against the
 * value stamped into each token. Every token issued before this call stops validating on its
 * next request.
 *
 * Exists as its own endpoint because the other revocation paths are side effects of some other
 * change (password, role, deactivation). An operator responding to a suspected stolen laptop
 * or shared credential needs to revoke *without* also altering the account.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const actor = userOrRes as SessionUser;

  const { id } = await params;

  // A Floor Manager may only do this to someone inside their floor. Directors are unrestricted.
  if (actor.role !== 'director' && !(await canAccessUser(actor, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, authVersion: true },
    });
    if (!target) return notFound('User not found');

    const updated = await prisma.user.update({
      where: { id },
      data: { authVersion: { increment: 1 } },
      select: { authVersion: true },
    });

    // Pod scoping is cached per viewer for 60s; a revoked user should stop appearing as an
    // active session holder immediately rather than after the TTL.
    clearVisibleUserCache();

    await logAdminAudit({
      actorId: actor.id,
      action: 'admin.user.sign_out_all',
      tableName: 'User',
      recordId: id,
      targetUserId: id,
      changedFields: { authVersion: { old: target.authVersion, new: updated.authVersion } },
    });

    return NextResponse.json({ success: true, authVersion: updated.authVersion });
  } catch (err) {
    return handleApiError('api/admin/users/[id]/sign-out-all POST', err);
  }
}
