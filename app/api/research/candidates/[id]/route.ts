import { NextResponse } from 'next/server';

import { requireResearchUser } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { getCandidateEvidence } from '@/lib/research/readModel';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireResearchUser();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id } = await context.params;
  const detail = await getCandidateEvidence(id, tenantId);
  if (!detail) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });

  return NextResponse.json(detail);
}
