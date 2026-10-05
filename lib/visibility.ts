import { getVisibleUserIds, type SessionUser } from '@/lib/auth';
import { MANAGER_ROLES } from '@/lib/authRoles';
import { prisma } from '@/lib/prisma';

/**
 * Who sees a sequence or a template.
 *
 * Both were tenant-wide: every rep saw, and could open, every colleague's cadences and copy
 * (owner, 2026-10-05: "everybody are still sharing the same view, no privacy per account"). The
 * rule now is the one leads already follow, plus an explicit way to share:
 *
 *   - you see what you created;
 *   - you see what the people under you created — `getVisibleUserIds` walks `managerId`, so a
 *     team lead sees their pod, a floor manager their team leads' pods, a director everything;
 *   - everyone sees what a manager marked shared.
 *
 * Seeing a shared row is not owning it: changing one is for its creator and the managers above
 * them, so a shared template cannot be rewritten under the cadences that send it.
 */

/**
 * The creators whose sequences and templates the caller reaches, or null for everyone.
 *
 * `getVisibleUserIds` walks active users only. A rep who is deactivated keeps their cadences
 * running, and without this their private sequences and templates would be reachable by a
 * director alone — their own team lead could no longer see, fix or share them.
 */
async function creatorsInReach(user: SessionUser): Promise<string[] | null> {
  const visible = await getVisibleUserIds(user);
  if (visible === null || user.role === 'sdr' || !user.tenantId) return visible;
  const departed = await prisma.user.findMany({
    where: { tenantId: user.tenantId, isActive: false, managerId: { in: visible } },
    select: { id: true },
  });
  return departed.length ? [...visible, ...departed.map((u) => u.id)] : visible;
}

type Owned = { createdById: string; isShared: boolean };

/** A Prisma `where` fragment for a model with `createdById` and `isShared`. `{}` = unrestricted. */
export async function ownedOrSharedWhere(
  user: SessionUser,
): Promise<{ OR?: [{ isShared: true }, { createdById: { in: string[] } }] }> {
  const visible = await creatorsInReach(user);
  if (visible === null) return {};
  // The viewer's own id is always included: a role whose tree is empty still owns what it made.
  const ids = visible.includes(user.id) ? visible : [...visible, user.id];
  return { OR: [{ isShared: true }, { createdById: { in: ids } }] };
}

export async function canViewOwned(user: SessionUser, row: Owned): Promise<boolean> {
  if (row.isShared || row.createdById === user.id) return true;
  const visible = await creatorsInReach(user);
  return visible === null || visible.includes(row.createdById);
}

/** Its creator, or a manager with the creator in their tree. Sharing alone grants no edit. */
export async function canManageOwned(user: SessionUser, row: { createdById: string }): Promise<boolean> {
  if (row.createdById === user.id) return true;
  if (!(MANAGER_ROLES as readonly string[]).includes(user.role)) return false;
  const visible = await creatorsInReach(user);
  return visible === null || visible.includes(row.createdById);
}

/** Whether the caller may see this sequence. False for one that does not exist, too. */
export async function canViewSequenceId(user: SessionUser, sequenceId: string): Promise<boolean> {
  if (!user.tenantId) return false;
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, tenantId: user.tenantId },
    select: { createdById: true, isShared: true },
  });
  return Boolean(sequence) && canViewOwned(user, sequence!);
}

/**
 * What the caller may do with a template: nothing (it does not exist for them), read it, or
 * change it. One lookup for the routes that hang off a template — variants, attachments.
 */
export async function templateAccess(user: SessionUser, templateId: string): Promise<'none' | 'view' | 'manage'> {
  if (!user.tenantId) return 'none';
  const template = await prisma.template.findFirst({
    where: { id: templateId, tenantId: user.tenantId },
    select: { createdById: true, isShared: true },
  });
  if (!template || !(await canViewOwned(user, template))) return 'none';
  return (await canManageOwned(user, template)) ? 'manage' : 'view';
}

/**
 * The templates among `ids` the caller may not use: invisible to them, or not in their tenant.
 *
 * Checked when a sequence step is pointed at a template, which is the moment the copy becomes the
 * caller's to send. Never at send time — a cadence that is already running keeps its template
 * whoever can see it now.
 */
export async function unusableTemplateIds(user: SessionUser, ids: Array<string | null | undefined>): Promise<string[]> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return [];
  if (!user.tenantId) return wanted;
  const rows = await prisma.template.findMany({
    where: { id: { in: wanted }, tenantId: user.tenantId },
    select: { id: true, createdById: true, isShared: true },
  });
  const usable = new Set<string>();
  for (const row of rows) if (await canViewOwned(user, row)) usable.add(row.id);
  return wanted.filter((id) => !usable.has(id));
}

/**
 * `canManageOwned` for a whole list at once, so a page can disable what the API would refuse
 * without one lookup per row.
 */
export async function withCanManage<T extends { createdById: string }>(
  user: SessionUser,
  rows: T[],
): Promise<Array<T & { canManage: boolean }>> {
  const isManager = (MANAGER_ROLES as readonly string[]).includes(user.role);
  const visible = isManager ? await creatorsInReach(user) : [];
  return rows.map((row) => ({
    ...row,
    canManage: row.createdById === user.id || (isManager && (visible === null || visible.includes(row.createdById))),
  }));
}

/** Marking something shared puts it in front of the whole company, so it is a manager's call. */
export function canShare(user: SessionUser): boolean {
  return (MANAGER_ROLES as readonly string[]).includes(user.role);
}
