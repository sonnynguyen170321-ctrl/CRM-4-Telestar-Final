import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireResearchPromoter } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { ResearchCampaignUnavailableError } from '@/lib/research/campaigns';
import { promoteCandidates } from '@/lib/research/promote';

const promoteSchema = z
  .object({
    candidateIds: z.array(z.string().min(1)).min(1).max(200),
    campaignId: z.string().min(1),
  })
  .strict();

export async function POST(req: NextRequest) {
  const user = await requireResearchPromoter();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = promoteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid promote request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const results = await promoteCandidates({
      tenantId,
      actor: user,
      candidateIds: parsed.data.candidateIds,
      campaignId: parsed.data.campaignId,
    });
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof ResearchCampaignUnavailableError) {
      return NextResponse.json(
        { error: 'Campaign is not available for Research' },
        { status: 404 },
      );
    }
    throw error;
  }
}
