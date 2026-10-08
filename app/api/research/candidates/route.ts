import { NextRequest, NextResponse } from 'next/server';

import { requireResearchUser } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { listResearchCandidates, VERIFICATION_FILTERS, type VerificationFilter } from '@/lib/research/readModel';

export async function GET(req: NextRequest) {
  const user = await requireResearchUser();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const params = new URL(req.url).searchParams;
  const minFit = params.get('minFitScore');
  const verification = params.get('verification');
  if (verification !== null && !VERIFICATION_FILTERS.includes(verification as VerificationFilter)) {
    return NextResponse.json({ error: 'Invalid verification filter' }, { status: 400 });
  }

  const result = await listResearchCandidates(
    {
      runId: params.get('runId') ?? undefined,
      status: params.get('status') ?? undefined,
      minFitScore: minFit === null ? undefined : Number(minFit),
      hidePreviouslyPromoted: params.get('hidePreviouslyPromoted') === 'true',
      verification: (verification as VerificationFilter | null) ?? undefined,
      page: Number(params.get('page') ?? 1),
      pageSize: Number(params.get('pageSize') ?? 50),
    },
    tenantId
  );

  return NextResponse.json(result);
}
