import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, getLeadgenScope } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // Leadgen Manager (or higher) only
  const scope = await getLeadgenScope(user);
  if (scope.kind !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { leadIds, campaignId, assignedToId } = await req.json();

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'No leadIds provided' }, { status: 400 });
    }

    const updateData: Record<string, any> = {};
    if (campaignId) updateData.campaignId = campaignId;
    if (assignedToId) updateData.assignedToId = assignedToId;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Perform bulk update
    await prisma.lead.updateMany({
      where: { id: { in: leadIds } },
      data: updateData,
    });

    // Create activity logs for these lead reassignments
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, firstName: true, lastName: true },
    });

    // No `tenantId` here on purpose. The client extension in `lib/prisma.ts` stamps it onto every
    // write, including each row of a `createMany`. Passing it by hand meant carrying a
    // `|| 'default-tenant'` fallback, and a session that somehow arrived without a tenant would
    // then write audit rows into a tenant nobody owns rather than failing — the blind tenant
    // default the runtime rules forbid.
    await prisma.activity.createMany({
      data: leads.map((l) => ({
        userId: user.id,
        leadId: l.id,
        type: 'stage_changed' as const,
        description: `Lead reassigned by Leadgen Manager`,
      })),
    });

    return NextResponse.json({ success: true, count: leadIds.length });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
