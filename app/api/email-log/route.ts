import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAuth, getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import {
  EMAIL_LOG_STATUS_GROUPS,
  buildEmailLogWhere,
  parseEmailLogFilters,
  statusGroupOf,
  type EmailLogStatusGroup,
} from '@/lib/email/emailLog';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * GET /api/email-log — outbound email the viewer can see, newest first, a page at a time.
 *
 * Scoped to the viewer's leads (getLeadWhereScope) on every query, including the counts and the
 * filter options. Query: the filters in lib/email/emailLog.ts, plus `cursor` (the last row's id).
 * Answers rows, `nextCursor`, per-status-group `counts` for the same filters (status aside, so the
 * tabs show what is behind each), and the mailboxes and sequences present, for the filter menus.
 */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const params = new URL(req.url).searchParams;
    const filters = parseEmailLogFilters(params);
    const scope = (await getLeadWhereScope(user)) as Prisma.LeadWhereInput;
    const where = buildEmailLogWhere(scope, filters);
    const { status: _status, ...withoutStatus } = filters;
    const countWhere = buildEmailLogWhere(scope, withoutStatus);
    const scopeOnly = buildEmailLogWhere(scope, {});
    const cursor = params.get('cursor');

    const [rows, byStatus, byAccount, bySequence] = await Promise.all([
      prisma.outboundMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          createdAt: true,
          sentAt: true,
          status: true,
          errorMessage: true,
          to: true,
          subject: true,
          sequenceId: true,
          sequenceStepOrder: true,
          openedAt: true,
          openCount: true,
          clickedAt: true,
          clickCount: true,
          repliedAt: true,
          bouncedAt: true,
          account: { select: { id: true, email: true } },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              company: true,
              assignedTo: { select: { id: true, firstName: true, lastName: true } },
              campaign: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.outboundMessage.groupBy({ by: ['status'], where: countWhere, _count: { _all: true } }),
      prisma.outboundMessage.groupBy({ by: ['accountId'], where: scopeOnly, _count: { _all: true } }),
      prisma.outboundMessage.groupBy({ by: ['sequenceId'], where: scopeOnly, _count: { _all: true } }),
    ]);

    const accountIds = byAccount.map((row) => row.accountId).filter((value): value is string => Boolean(value));
    const sequenceIds = bySequence.map((row) => row.sequenceId).filter((value): value is string => Boolean(value));
    const [mailboxes, sequences] = await Promise.all([
      accountIds.length
        ? prisma.emailAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, email: true }, orderBy: { email: 'asc' } })
        : [],
      sequenceIds.length
        ? prisma.sequence.findMany({ where: { id: { in: sequenceIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
        : [],
    ]);
    const sequenceName = new Map(sequences.map((sequence) => [sequence.id, sequence.name]));

    const counts = Object.fromEntries(Object.keys(EMAIL_LOG_STATUS_GROUPS).map((group) => [group, 0])) as Record<
      EmailLogStatusGroup | 'all',
      number
    >;
    counts.all = 0;
    for (const row of byStatus) {
      const group = statusGroupOf(row.status);
      if (group) counts[group] += row._count._all;
      counts.all += row._count._all;
    }

    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    return NextResponse.json({
      rows: page.map((row) => ({
        ...row,
        statusGroup: statusGroupOf(row.status),
        sequenceName: row.sequenceId ? (sequenceName.get(row.sequenceId) ?? null) : null,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      counts,
      options: { mailboxes, sequences },
    });
  } catch (err) {
    return handleApiError('api/email-log GET', err);
  }
}
