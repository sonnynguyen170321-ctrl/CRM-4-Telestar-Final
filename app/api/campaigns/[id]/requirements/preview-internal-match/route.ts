import { NextRequest, NextResponse } from 'next/server';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { matchInternalInventoryForCampaign } from '@/lib/contact-intelligence/matching';
import { handleApiError } from '@/lib/api/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id: campaignId } = await params;
  const sp = req.nextUrl.searchParams;

  const titles = sp.get('titles') ? sp.get('titles')!.split(',').map((t) => t.trim()) : undefined;
  const countries = sp.get('countries') ? sp.get('countries')!.split(',').map((c) => c.trim()) : undefined;
  const industries = sp.get('industries') ? sp.get('industries')!.split(',').map((i) => i.trim()) : undefined;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;

  try {
    const result = await matchInternalInventoryForCampaign({
      campaignId,
      tenantId,
      targetTitles: titles,
      targetCountries: countries,
      targetIndustries: industries,
      limit,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError('api/campaigns/[id]/requirements/preview-internal-match GET', err);
  }
}
