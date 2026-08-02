import { NextRequest, NextResponse } from 'next/server';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { buildPoolWhere, poolItemsToCsv } from '@/lib/leadgen/pool';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const sp = req.nextUrl.searchParams;
  const tenantId = user.tenantId || 'default-tenant';

  const where = buildPoolWhere(
    {
      status: sp.get('status') ?? undefined,
      qualification: sp.get('qualification') ?? undefined,
      search: sp.get('search') ?? undefined,
      sourceType: sp.get('sourceType') ?? undefined,
      assignedCampaignId: sp.get('campaignId') ?? undefined,
      assignedSdrId: sp.get('sdrId') ?? undefined,
    },
    tenantId
  ) as never;

  const items = await prisma.leadPoolItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
    select: {
      firstName: true,
      lastName: true,
      company: true,
      title: true,
      email: true,
      phone: true,
      linkedIn: true,
      website: true,
      country: true,
      industry: true,
      status: true,
      qualification: true,
      sourceType: true,
      sourceName: true,
      icpFitScore: true,
      dataQualityScore: true,
      emailValidation: true,
      emailScore: true,
    },
  });

  const csv = poolItemsToCsv(items);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leadgen-pool-${Date.now()}.csv"`,
    },
  });
}
