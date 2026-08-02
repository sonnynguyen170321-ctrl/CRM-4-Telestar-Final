import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { notFound, handleApiError } from '@/lib/api/errors';
import { capLimit } from '@/lib/validation/core';
import { canAccessEmailAccount } from '@/lib/email-health/access';
import { getInboxHealthRows } from '@/lib/email-health/queries';

export const dynamic = 'force-dynamic';

const SNAPSHOT_DEFAULT_LIMIT = 30;
const SNAPSHOT_MAX_LIMIT = 180;

/** One inbox: live score, recent snapshots for the trend chart, and open alerts. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const { id } = await params;
    if (!(await canAccessEmailAccount(user, id))) return notFound('Email account not found');

    const limit = capLimit(
      new URL(req.url).searchParams.get('limit'),
      SNAPSHOT_DEFAULT_LIMIT,
      SNAPSHOT_MAX_LIMIT
    );

    // Reuse the same scoring path as the table so detail and list can never disagree.
    const { rows } = await getInboxHealthRows(user, {});
    const account = rows.find((r) => r.id === id);
    if (!account) return notFound('Email account not found');

    const [snapshots, alerts, recentBounces] = await Promise.all([
      prisma.emailHealthSnapshot.findMany({
        where: { accountId: id },
        orderBy: { windowEnd: 'desc' },
        take: limit,
        select: {
          windowStart: true, windowEnd: true, sentCount: true, hardBounceCount: true,
          softBounceCount: true, replyCount: true, spamSignalCount: true,
          healthScore: true, healthLevel: true, createdAt: true,
        },
      }),
      prisma.emailHealthAlert.findMany({
        where: { accountId: id, status: { in: ['open', 'acknowledged'] } },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }),
      prisma.outboundMessage.findMany({
        where: { accountId: id, status: 'bounced' },
        orderBy: { bouncedAt: 'desc' },
        take: 20,
        select: {
          id: true, to: true, subject: true, bounceType: true, bouncedAt: true,
          lead: { select: { id: true, firstName: true, lastName: true, company: true } },
        },
      }),
    ]);

    return NextResponse.json(
      // Oldest-first so the chart reads left to right.
      { account, snapshots: snapshots.reverse(), alerts, recentBounces },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return handleApiError('api/email-health/accounts/[id] GET', err);
  }
}
