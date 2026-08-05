import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getManageScope, canManage, type ManageScope } from '@/lib/admin/scope';
import { addCampaignMember, removeCampaignMember } from '@/lib/admin/campaignMembers';
import { parseBody, id } from '@/lib/validation/core';
import { removeMemberSchema } from '@/lib/validation/schemas';
import { z } from 'zod';
import { handleApiError, notFound } from '@/lib/api/errors';

/**
 * Campaign membership, addressed by campaign. A thin façade over
 * `lib/admin/campaignMembers.ts` — the enforcement (including the 409 that
 * blocks removing a member who still owns open work) lives there, shared with
 * `/api/admin/assignments`.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id: campaignId } = await params;
  const scope = await getManageScope(user);
  if (scope.kind === 'none') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        status: true,
        client: { select: { id: true, name: true, status: true } },
        _count: { select: { leads: true, meetings: true, opportunities: true } },
      },
    });
    if (!campaign) return notFound('Campaign not found');

    const memberRows = await prisma.campaignSdr.findMany({
      where: { campaignId },
      select: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, email: true,
            role: true, managerId: true, isActive: true,
          },
        },
      },
    });
    const memberIds = memberRows.map((m) => m.user.id);
    const now = new Date();

    // Per-member counts in four grouped queries, not four per member.
    const [leads, tasks, meetings, opportunities, candidates] = await Promise.all([
      memberIds.length
        ? prisma.lead.groupBy({
            by: ['assignedToId'],
            where: {
              campaignId,
              assignedToId: { in: memberIds },
              archivedAt: null,
              stage: { notIn: ['won', 'lost'] },
            },
            _count: { _all: true },
          })
        : [],
      memberIds.length
        ? prisma.task.groupBy({
            by: ['userId'],
            where: { userId: { in: memberIds }, status: 'pending', lead: { campaignId } },
            _count: { _all: true },
          })
        : [],
      memberIds.length
        ? prisma.meeting.groupBy({
            by: ['sdrId'],
            where: {
              campaignId,
              sdrId: { in: memberIds },
              status: { in: ['scheduled', 'link_sent'] },
              scheduledAt: { gte: now },
            },
            _count: { _all: true },
          })
        : [],
      memberIds.length
        ? prisma.opportunity.groupBy({
            by: ['ownerId'],
            where: { campaignId, ownerId: { in: memberIds }, status: 'open' },
            _count: { _all: true },
          })
        : [],
      prisma.user.findMany({
        where: {
          isActive: true,
          id: { notIn: memberIds, ...scopeUserFilter(scope) },
          role: { in: ['sdr', 'team_lead', 'floor_manager', 'leadgen', 'leadgen_manager'] },
        },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
        orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      }),
    ]);

    const leadCount = new Map(leads.map((r) => [r.assignedToId, r._count._all]));
    const taskCount = new Map(tasks.map((r) => [r.userId, r._count._all]));
    const meetingCount = new Map(meetings.map((r) => [r.sdrId, r._count._all]));
    const oppCount = new Map(opportunities.map((r) => [r.ownerId, r._count._all]));

    return NextResponse.json(
      {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          clientName: campaign.client.name,
          clientStatus: campaign.client.status,
          leadCount: campaign._count.leads,
          meetingCount: campaign._count.meetings,
          opportunityCount: campaign._count.opportunities,
        },
        members: memberRows.map(({ user: m }) => ({
          id: m.id,
          name: `${m.firstName} ${m.lastName}`.trim(),
          email: m.email,
          role: m.role,
          managerId: m.managerId,
          isActive: m.isActive,
          canManage: canManage(scope, m.id, campaignId),
          assignedLeadCount: leadCount.get(m.id) ?? 0,
          openTaskCount: taskCount.get(m.id) ?? 0,
          scheduledMeetingCount: meetingCount.get(m.id) ?? 0,
          openOpportunityCount: oppCount.get(m.id) ?? 0,
        })),
        availableUsers: candidates
          .filter((c) => canManage(scope, c.id, campaignId))
          .map((c) => ({
            id: c.id,
            name: `${c.firstName} ${c.lastName}`.trim(),
            email: c.email,
            role: c.role,
          })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return handleApiError('api/campaigns/[id]/members GET', err);
  }
}

const addMembersSchema = z.object({ userIds: z.array(id).min(1).max(50) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id: campaignId } = await params;
  const parsed = await parseBody(req, addMembersSchema, 'Invalid member add');
  if (parsed.error) return parsed.error;

  try {
    const results = await Promise.all(
      parsed.data.userIds.map(async (userId) => ({
        userId,
        result: await addCampaignMember(user, { userId, campaignId }),
      }))
    );

    const failed = results.filter((r) => !r.result.ok);
    if (failed.length === results.length) {
      const first = failed[0].result as { status: number; error: string };
      return NextResponse.json({ error: first.error }, { status: first.status });
    }

    return NextResponse.json(
      {
        success: true,
        added: results.length - failed.length,
        failed: failed.map((f) => ({
          userId: f.userId,
          error: (f.result as { error: string }).error,
        })),
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError('api/campaigns/[id]/members POST', err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id: campaignId } = await params;
  const parsed = await parseBody(
    req,
    removeMemberSchema.omit({ campaignId: true }),
    'Invalid member removal'
  );
  if (parsed.error) return parsed.error;

  try {
    const result = await removeCampaignMember(user, { ...parsed.data, campaignId });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.impact ? { impact: result.impact } : {}) },
        { status: result.status }
      );
    }
    return NextResponse.json({
      success: true,
      mode: result.mode,
      transferred: result.transferred ?? null,
      paused: result.paused ?? null,
    });
  } catch (err) {
    return handleApiError('api/campaigns/[id]/members DELETE', err);
  }
}

function scopeUserFilter(scope: ManageScope): { in?: string[] } {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'none') return { in: [] };
  return { in: [...scope.userIds] };
}
