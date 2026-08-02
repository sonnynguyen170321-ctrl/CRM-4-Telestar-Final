import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { handleApiError, forbidden, notFound } from '@/lib/api/errors';
import { canAccessOpportunity } from '@/lib/opportunities/access';
import { addOpportunityNote } from '@/lib/opportunities/lifecycle';

type RouteContext = { params: Promise<{ id: string }> };

const addNoteSchema = z.object({
  note: z.string().min(1).max(20_000),
});

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;

  try {
    const opp = await prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, ownerId: true, createdById: true, campaignId: true, tenantId: true, leadId: true },
    });
    if (!opp) return notFound('Opportunity not found');
    if (!(await canAccessOpportunity(user, opp))) return forbidden();

    const activities = await prisma.opportunityActivity.findMany({
      where: { opportunityId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    return NextResponse.json(activities);
  } catch (err) {
    return handleApiError('GET /api/opportunities/[id]/activity', err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, addNoteSchema, 'Invalid note');
  if (parsed.error) return parsed.error;

  try {
    const opp = await prisma.opportunity.findUnique({
      where: { id },
      select: { id: true, ownerId: true, createdById: true, campaignId: true, tenantId: true, leadId: true },
    });
    if (!opp) return notFound('Opportunity not found');
    if (!(await canAccessOpportunity(user, opp))) return forbidden();

    await addOpportunityNote({
      opportunityId: id,
      user,
      tenantId: opp.tenantId,
      note: parsed.data.note,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError('POST /api/opportunities/[id]/activity', err);
  }
}
