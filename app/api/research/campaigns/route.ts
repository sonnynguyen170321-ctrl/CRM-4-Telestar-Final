import { NextResponse } from 'next/server';

import { requireResearchUser } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { listResearchCampaigns } from '@/lib/research/campaigns';

export async function GET() {
  const user = await requireResearchUser();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  return NextResponse.json({
    campaigns: await listResearchCampaigns(user, tenantId),
  });
}
