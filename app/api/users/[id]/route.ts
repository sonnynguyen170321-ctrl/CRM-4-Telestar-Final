import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessUser, clearVisibleUserCache } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { hash } from 'bcryptjs';
import { parseBody } from '@/lib/validation/core';
import { updateUserSchema } from '@/lib/validation/schemas';
import { wouldCreateManagerCycle } from '@/lib/podScoping';
import { isValidManagerRole, describeManagerRoleRule } from '@/lib/admin/orgRules';
import { logAdminAudit } from '@/lib/audit';
import { badRequest, handleApiError } from '@/lib/api/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const currentUser = userOrRes as SessionUser;

  const { id } = await params;
  if (!(await canAccessUser(currentUser, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      managerId: true,
      avatarUrl: true,
      timezone: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(user);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const currentUser = userOrRes as SessionUser;

  const { id } = await params;
  const parsed = await parseBody(req, updateUserSchema, 'Invalid user update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const isSelf = currentUser.id === id;
  const isDirector = currentUser.role === 'director';
  const isFloorManager = currentUser.role === 'floor_manager';

  // A Floor Manager may manage team membership for users inside their own floor.
  const fmCanManage = isFloorManager && !isSelf && (await canAccessUser(currentUser, id));

  // Authorize: self, director (any), or floor manager editing an in-floor user.
  if (!isSelf && !isDirector && !fmCanManage) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, managerId: true, isActive: true },
  });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updateData: any = {};

  // Profile fields: only the user themselves or a director.
  if (isSelf || isDirector) {
    if (body.firstName !== undefined) updateData.firstName = body.firstName;
    if (body.lastName !== undefined) updateData.lastName = body.lastName;
    if (body.timezone !== undefined) updateData.timezone = body.timezone;
    if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;
  }

  // Director-only fields
  if (isDirector) {
    if (body.role !== undefined) updateData.role = body.role;
    if (body.managerId !== undefined) updateData.managerId = body.managerId;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
  }

  // Floor Manager — may reassign team membership (managerId) within their floor.
  // Both the target (checked above) and the new manager must be inside the floor;
  // null (orphaning the user) stays Director-only.
  if (fmCanManage && body.managerId !== undefined && body.managerId !== null) {
    if (!(await canAccessUser(currentUser, body.managerId))) {
      return NextResponse.json({ error: 'Forbidden: manager outside your floor' }, { status: 403 });
    }
    updateData.managerId = body.managerId;
  }

  // Password reset — directors only; regular users must use /api/settings/password
  if (body.newPassword && currentUser.role === 'director') {
    updateData.password = await hash(body.newPassword, 12);
  }

  // ── Org-integrity validation ──────────────────────────────────────────────
  // Runs on the resolved `updateData`, so it covers both the director and the
  // floor-manager write paths above.
  const nextRole = (updateData.role ?? target.role) as SessionUser['role'];
  const managerChanged = updateData.managerId !== undefined;
  const roleChanged = updateData.role !== undefined && updateData.role !== target.role;
  const activeChanged = updateData.isActive !== undefined && updateData.isActive !== target.isActive;

  try {
    if (managerChanged || roleChanged) {
      const nextManagerId = (managerChanged ? updateData.managerId : target.managerId) as
        | string
        | null;

      if (nextManagerId === id) {
        return badRequest('A user cannot be their own manager.');
      }

      if (nextManagerId) {
        const nextManager = await prisma.user.findUnique({
          where: { id: nextManagerId },
          select: { id: true, role: true, isActive: true },
        });
        if (!nextManager) return badRequest('Manager not found.');
        if (!nextManager.isActive) {
          return badRequest('Cannot report to a deactivated user.');
        }
        if (!isValidManagerRole(nextRole, nextManager.role)) {
          return badRequest(describeManagerRoleRule(nextRole));
        }

        const org = await prisma.user.findMany({
          select: { id: true, role: true, managerId: true },
        });
        if (wouldCreateManagerCycle(org, id, nextManagerId)) {
          return badRequest('That manager assignment would create a circular reporting chain.');
        }
      }
    }

    // Deactivation must not silently orphan a pod. `reassignReportsTo` moves the
    // reports first; without it the request is refused so the caller has to decide.
    if (activeChanged && updateData.isActive === false) {
      const reports = await prisma.user.findMany({
        where: { managerId: id, isActive: true },
        select: { id: true, firstName: true, lastName: true, role: true },
      });

      if (reports.length > 0) {
        const reassignTo = body.reassignReportsTo;
        if (!reassignTo) {
          return NextResponse.json(
            {
              error: 'This user still manages active reports. Reassign them first.',
              reports: reports.map((r) => ({
                id: r.id,
                name: `${r.firstName} ${r.lastName}`.trim(),
              })),
            },
            { status: 409 }
          );
        }

        if (reassignTo === id) {
          return badRequest('Reports cannot be reassigned to the user being deactivated.');
        }
        const newManager = await prisma.user.findUnique({
          where: { id: reassignTo },
          select: { id: true, role: true, isActive: true },
        });
        if (!newManager?.isActive) {
          return badRequest('The replacement manager must be an active user.');
        }
        if (!(await canAccessUser(currentUser, reassignTo))) {
          return NextResponse.json(
            { error: 'Forbidden: replacement manager outside your scope' },
            { status: 403 }
          );
        }
        // Every report must legally be able to report to the replacement.
        const incompatible = reports.filter((r) => !isValidManagerRole(r.role, newManager.role));
        if (incompatible.length > 0) {
          return badRequest(
            `${incompatible.map((r) => `${r.firstName} ${r.lastName}`.trim()).join(', ')} cannot report to a ${newManager.role}.`
          );
        }
        await prisma.user.updateMany({
          where: { managerId: id, isActive: true },
          data: { managerId: reassignTo },
        });
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, managerId: true, timezone: true, isActive: true,
      },
    });

    // Pod scoping is cached for 60s keyed by *viewer*, so moving one user
    // invalidates every manager's entry — clear the whole map, not one key.
    // Per-process only: on serverless the TTL remains the real bound.
    if (managerChanged || roleChanged || activeChanged) {
      clearVisibleUserCache();
    }

    // The send worker gates on EmailAccount.isActive / sendPausedAt, NOT on
    // User.isActive — so without this a deactivated rep's connected mailbox
    // keeps sending sequence email.
    if (activeChanged && updateData.isActive === false) {
      await prisma.emailAccount.updateMany({
        where: { userId: id, sendPausedAt: null },
        data: {
          sendPausedAt: new Date(),
          sendPausedById: currentUser.id,
          sendPauseReason: 'Owner deactivated',
        },
      });
    }

    // Actor-stamped trail. `auditExtension` also fires, but attributes the row to
    // the target user rather than the director who made the change.
    const auditBase = { actorId: currentUser.id, tableName: 'User', recordId: id, targetUserId: id };
    if (roleChanged) {
      await logAdminAudit({
        ...auditBase,
        action: 'admin.user.role_change',
        changedFields: { role: { old: target.role, new: updateData.role } },
      });
    }
    if (managerChanged) {
      await logAdminAudit({
        ...auditBase,
        action: 'admin.user.manager_change',
        changedFields: { managerId: { old: target.managerId, new: updateData.managerId } },
      });
    }
    if (activeChanged) {
      await logAdminAudit({
        ...auditBase,
        action: updateData.isActive ? 'admin.user.reactivate' : 'admin.user.deactivate',
        changedFields: { isActive: { old: target.isActive, new: updateData.isActive } },
      });
    }
    if (updateData.password) {
      await logAdminAudit({ ...auditBase, action: 'admin.user.password_reset' });
    }

    return NextResponse.json(user);
  } catch (err) {
    return handleApiError('api/users/[id] PUT', err);
  }
}
