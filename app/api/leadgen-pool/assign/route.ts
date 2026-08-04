import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { assignPoolItems } from '@/lib/leadgen/pool';
import { canAssignToRep } from '@/lib/leadgen/assignableReps';
import { prisma } from '@/lib/prisma';

const assignSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  campaignId: z.string().optional(),
  sdrIds: z.array(z.string().min(1)).optional(),
  method: z.enum(['single', 'round_robin']).default('single'),
});

export async function POST(req: NextRequest) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = assignSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid assign request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { campaignId, sdrIds, method, ids } = parsed.data;
  if (!campaignId && (!sdrIds || sdrIds.length === 0)) {
    return NextResponse.json({ error: 'Provide a campaignId or at least one sdrId' }, { status: 400 });
  }

  // Same campaign-scoped rule as the convert route — see lib/leadgen/assignableReps.ts.
  for (const sdrId of sdrIds ?? []) {
    if (!(await canAssignToRep(user, sdrId, campaignId))) {
      return NextResponse.json({ error: `Forbidden: cannot assign to user ${sdrId}` }, { status: 403 });
    }
  }

  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId },
      select: { id: true },
    });
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 400 });
    }
  }

  const tenantId = user.tenantId || 'default-tenant';
  const result = await assignPoolItems({
    itemIds: ids,
    campaignId,
    sdrIds: sdrIds ?? [],
    method,
    actor: user,
    tenantId,
  });

  return NextResponse.json(result);
}
