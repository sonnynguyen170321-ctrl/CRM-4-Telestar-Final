import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getManageScope } from '@/lib/admin/scope';
import { addCampaignMember, removeCampaignMember } from '@/lib/admin/campaignMembers';
import { parseBody, id } from '@/lib/validation/core';
import { removeMemberSchema } from '@/lib/validation/schemas';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';

/**
 * Control plane for user↔account assignments (`CampaignSdr`). The two admin
 * domains and their scoping rules live in `lib/admin/scope.ts` so the campaign
 * member and work-transfer services enforce exactly the same rules.
 * A cross-domain or out-of-scope mutation returns 403.
 */

/**
 * Returns everything the Settings "Team & Accounts" panel needs in one scoped
 * call: which domain to render, the assignable members + account options the
 * caller may touch, the manager choices for team-membership editing, and the
 * current `CampaignSdr` assignments — all already scoped server-side.
 */
export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const scope = await getManageScope(user);
  if (scope.kind === 'none') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isLeadgen = scope.kind === 'leadgen';
  const userFilter = scope.kind === 'all' ? {} : { userId: { in: [...scope.userIds] } };

  try {
    // Assignable members + manager choices, scoped to the caller's domain.
    const userScopeWhere = scope.kind === 'all' ? {} : { id: { in: [...scope.userIds] } };
    const memberRoles = isLeadgen
      ? (['leadgen'] as const)
      : (['sdr', 'team_lead'] as const);

    const [memberRows, managerRows, campaignRows, assignmentRows] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true, role: { in: [...memberRoles] }, ...userScopeWhere },
        select: { id: true, firstName: true, lastName: true, role: true, managerId: true },
        orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      }),
      // Manager choices for team-membership editing (SDR org only).
      isLeadgen
        ? Promise.resolve([])
        : prisma.user.findMany({
            where: {
              isActive: true,
              role: { in: ['team_lead', 'floor_manager'] },
              ...userScopeWhere,
            },
            select: { id: true, firstName: true, lastName: true, role: true },
            orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
          }),
      // Assignable accounts: floor manager → only floor campaigns; else all.
      prisma.campaign.findMany({
        where: scope.kind === 'floor' ? { id: { in: [...scope.campaignIds] } } : {},
        select: { id: true, name: true, client: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.campaignSdr.findMany({
        where: userFilter,
        select: { userId: true, campaignId: true },
      }),
    ]);

    return NextResponse.json({
      domain: isLeadgen ? 'leadgen' : 'sdr_org',
      canEditTeam: scope.kind === 'all' || scope.kind === 'floor',
      members: memberRows.map((m) => ({
        id: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        role: m.role,
        managerId: m.managerId,
      })),
      managers: managerRows.map((m) => ({
        id: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        role: m.role,
      })),
      campaigns: campaignRows.map((c) => ({
        id: c.id,
        name: c.name,
        clientName: c.client.name,
      })),
      assignments: assignmentRows.map((a) => ({ userId: a.userId, campaignId: a.campaignId })),
    });
  } catch (err) {
    return handleApiError('api/admin/assignments GET', err);
  }
}

const assignmentSchema = z.object({ userId: id, campaignId: id });

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, assignmentSchema, 'Invalid assignment create');
  if (parsed.error) return parsed.error;

  try {
    const result = await addCampaignMember(user, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    return handleApiError('api/admin/assignments POST', err);
  }
}

/**
 * Removal goes through `removeCampaignMember`, which refuses (409) to drop a
 * member who still owns open work unless the caller names a handling mode.
 * The Settings "Team & Accounts" chip toggle used to DELETE straight through
 * here with no check — that is the hole this closes.
 */
export async function DELETE(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, removeMemberSchema, 'Invalid assignment delete');
  if (parsed.error) return parsed.error;

  try {
    const result = await removeCampaignMember(user, parsed.data);
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
    return handleApiError('api/admin/assignments DELETE', err);
  }
}
