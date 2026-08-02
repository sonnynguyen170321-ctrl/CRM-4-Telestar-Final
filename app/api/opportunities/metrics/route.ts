import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, getVisibleUserIds, getVisibleCampaignIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError, badRequest } from '@/lib/api/errors';
import { toNumber } from '@/lib/opportunities/metrics';

type GroupBy = 'sdr' | 'client' | 'campaign';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const groupBy = (searchParams.get('groupBy') || 'sdr') as GroupBy;
  if (!['sdr', 'client', 'campaign'].includes(groupBy)) {
    return badRequest('groupBy must be one of: sdr, client, campaign');
  }

  const scopeConditions: Record<string, unknown>[] = [];
  const visibleUserIds = await getVisibleUserIds(user);
  if (visibleUserIds !== null) {
    scopeConditions.push({
      OR: [{ ownerId: { in: visibleUserIds } }, { createdById: { in: visibleUserIds } }],
    });
  }
  const visibleCampaignIds = await getVisibleCampaignIds(user);
  if (visibleCampaignIds !== null && visibleCampaignIds.length > 0) {
    scopeConditions.push({ campaignId: { in: visibleCampaignIds } });
  }
  const where: Record<string, unknown> =
    scopeConditions.length > 0 ? { AND: scopeConditions } : {};

  try {
    const opps = await prisma.opportunity.findMany({
      where: where as never,
      select: {
        stage: true,
        status: true,
        handoffStatus: true,
        value: true,
        probability: true,
        owner: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    });

    const groups = new Map<string, {
      key: string;
      label: string;
      totalOpen: number;
      totalPipelineValue: number;
      weightedPipelineValue: number;
      won: number;
      lost: number;
      rejected: number;
      accepted: number;
      reviewed: number;
      pendingReview: number;
    }>();

    for (const opp of opps) {
      let key: string;
      let label: string;
      if (groupBy === 'sdr') {
        key = opp.owner.id;
        label = `${opp.owner.firstName} ${opp.owner.lastName}`;
      } else if (groupBy === 'client') {
        key = opp.client.id;
        label = opp.client.name;
      } else {
        key = opp.campaign.id;
        label = opp.campaign.name;
      }

      const g = groups.get(key) ?? {
        key,
        label,
        totalOpen: 0,
        totalPipelineValue: 0,
        weightedPipelineValue: 0,
        won: 0,
        lost: 0,
        rejected: 0,
        accepted: 0,
        reviewed: 0,
        pendingReview: 0,
      };

      if (opp.status === 'open') {
        g.totalOpen += 1;
        const value = toNumber(opp.value?.toString());
        if (value > 0) {
          g.totalPipelineValue += value;
          g.weightedPipelineValue += value * (opp.probability / 100);
        }
        if (opp.handoffStatus === 'pending' || opp.handoffStatus === 'needs_more_info') {
          g.pendingReview += 1;
        } else if (opp.handoffStatus === 'accepted') {
          g.accepted += 1;
          g.reviewed += 1;
        }
      } else if (opp.status === 'won') {
        g.won += 1;
      } else if (opp.status === 'lost') {
        g.lost += 1;
      } else if (opp.status === 'rejected') {
        g.rejected += 1;
        g.reviewed += 1;
      }

      groups.set(key, g);
    }

    const rows = [...groups.values()].map(g => ({
      ...g,
      acceptanceRate: g.reviewed > 0 ? Math.round((g.accepted / g.reviewed) * 1000) / 10 : 0,
    }));

    const totals = rows.reduce(
      (acc, r) => {
        acc.totalOpen += r.totalOpen;
        acc.totalPipelineValue += r.totalPipelineValue;
        acc.weightedPipelineValue += r.weightedPipelineValue;
        acc.won += r.won;
        acc.lost += r.lost;
        acc.rejected += r.rejected;
        acc.accepted += r.accepted;
        acc.reviewed += r.reviewed;
        acc.pendingReview += r.pendingReview;
        return acc;
      },
      { totalOpen: 0, totalPipelineValue: 0, weightedPipelineValue: 0, won: 0, lost: 0, rejected: 0, accepted: 0, reviewed: 0, pendingReview: 0 },
    );

    return NextResponse.json({
      groupBy,
      rows,
      totals: {
        ...totals,
        acceptanceRate: totals.reviewed > 0 ? Math.round((totals.accepted / totals.reviewed) * 1000) / 10 : 0,
      },
    });
  } catch (err) {
    return handleApiError('GET /api/opportunities/metrics', err);
  }
}
