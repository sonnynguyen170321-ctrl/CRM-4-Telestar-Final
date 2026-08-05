import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getVisibleUserIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { capLimit } from '@/lib/validation/core';
import { handleApiError } from '@/lib/api/errors';

/**
 * Read side of the audit trail.
 *
 * Two hard constraints shape this:
 *  1. `auditExtension` writes a row for EVERY create/update/delete on every
 *     model, so the table is large. A date window is always applied — without
 *     one this becomes the slowest route in the app within months.
 *  2. Offset pagination over a growing table drifts and duplicates rows, so
 *     paging is cursor-based on `createdAt` (which is indexed).
 */

const DEFAULT_WINDOW_DAYS = 30;
const LABEL_TABLES = new Set(['User', 'Campaign', 'Client', 'Lead']);

export async function GET(req: NextRequest) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const sp = req.nextUrl.searchParams;
    const limit = capLimit(sp.get('limit'), 50, 200);
    const scope = sp.get('scope') === 'all' ? 'all' : 'admin';

    const from = sp.get('from')
      ? new Date(sp.get('from') as string)
      : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000);
    const to = sp.get('to') ? new Date(sp.get('to') as string) : undefined;
    const cursor = sp.get('cursor') ? new Date(sp.get('cursor') as string) : undefined;

    // A floor manager sees actions taken by people in their floor, plus their own.
    const visibleIds = await getVisibleUserIds(user);
    const actorFilter = sp.get('actorId')
      ? { userId: sp.get('actorId') as string }
      : visibleIds
        ? { userId: { in: [...visibleIds, user.id] } }
        : {};

    const rows = await prisma.auditLog.findMany({
      where: {
        ...actorFilter,
        ...(scope === 'admin' ? { action: { startsWith: 'admin.' } } : {}),
        ...(sp.get('action') ? { action: sp.get('action') as string } : {}),
        ...(sp.get('tableName') ? { tableName: sp.get('tableName') as string } : {}),
        createdAt: {
          gte: from,
          ...(to ? { lte: to } : {}),
          ...(cursor ? { lt: cursor } : {}),
        },
      },
      select: {
        id: true,
        userId: true,
        action: true,
        tableName: true,
        recordId: true,
        changedFields: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const labels = await resolveLabels(page);

    return NextResponse.json(
      {
        entries: page.map((r) => ({
          id: r.id,
          action: r.action,
          tableName: r.tableName,
          recordId: r.recordId,
          createdAt: r.createdAt,
          actorId: r.userId,
          actorName: r.userId ? (labels.get(`User:${r.userId}`) ?? null) : null,
          targetLabel: labels.get(`${r.tableName}:${r.recordId}`) ?? null,
          changedFields: r.changedFields,
        })),
        nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
        window: { from: from.toISOString(), to: to?.toISOString() ?? null },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return handleApiError('api/admin/audit-log GET', err);
  }
}

/**
 * Turn ids into names for the rows on THIS page only — one query per table,
 * never one per row. Ids that no longer resolve (deleted, or a table we do not
 * label) simply render as a shortened id.
 */
async function resolveLabels(
  rows: { userId: string | null; tableName: string; recordId: string }[]
): Promise<Map<string, string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, id: string) => {
    if (!id) return;
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(id);
  };

  for (const r of rows) {
    if (r.userId) add('User', r.userId);
    if (LABEL_TABLES.has(r.tableName)) add(r.tableName, r.recordId);
  }

  const out = new Map<string, string>();

  await Promise.all(
    [...byTable.entries()].map(async ([table, ids]) => {
      const list = [...ids];
      if (table === 'User') {
        const users = await prisma.user.findMany({
          where: { id: { in: list } },
          select: { id: true, firstName: true, lastName: true },
        });
        users.forEach((u) => out.set(`User:${u.id}`, `${u.firstName} ${u.lastName}`.trim()));
      } else if (table === 'Campaign') {
        const items = await prisma.campaign.findMany({
          where: { id: { in: list } },
          select: { id: true, name: true },
        });
        items.forEach((c) => out.set(`Campaign:${c.id}`, c.name));
      } else if (table === 'Client') {
        const items = await prisma.client.findMany({
          where: { id: { in: list } },
          select: { id: true, name: true },
        });
        items.forEach((c) => out.set(`Client:${c.id}`, c.name));
      } else if (table === 'Lead') {
        const items = await prisma.lead.findMany({
          where: { id: { in: list } },
          select: { id: true, firstName: true, lastName: true, company: true },
        });
        items.forEach((l) =>
          out.set(`Lead:${l.id}`, `${l.firstName} ${l.lastName} — ${l.company}`.trim())
        );
      }
    })
  );

  return out;
}
