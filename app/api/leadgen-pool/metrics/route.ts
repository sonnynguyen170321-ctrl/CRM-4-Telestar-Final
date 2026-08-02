import { NextResponse } from 'next/server';
import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { getLeadgenMetrics } from '@/lib/leadgen/metrics';

export async function GET() {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  const tenantId = user.tenantId || 'default-tenant';
  return NextResponse.json(await getLeadgenMetrics(tenantId));
}
