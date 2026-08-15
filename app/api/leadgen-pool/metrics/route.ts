import { NextResponse } from 'next/server';
import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { getLeadgenMetrics } from '@/lib/leadgen/metrics';
import { requireTenantId } from '@/lib/api/tenant';

export async function GET() {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  return NextResponse.json(await getLeadgenMetrics(tenantId));
}
