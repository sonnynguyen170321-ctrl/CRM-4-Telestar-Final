import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { createPoolItem, listPoolItems } from '@/lib/leadgen/pool';
import { requireTenantId } from '@/lib/api/tenant';

const createPoolItemSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  company: z.string().min(1),
  title: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  linkedIn: z.string().optional(),
  website: z.string().optional(),
  country: z.string().optional(),
  industry: z.string().optional(),
  emailValidation: z.string().optional(),
  emailScore: z.number().optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const sp = req.nextUrl.searchParams;
  const num = (key: string) => {
    const value = sp.get(key);
    return value ? Number(value) : undefined;
  };

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const result = await listPoolItems(
    {
      status: sp.get('status') ?? undefined,
      qualification: sp.get('qualification') ?? undefined,
      qualityClass: sp.get('qualityClass') ?? undefined,
      reuseStatus: sp.get('reuseStatus') ?? undefined,
      dataStatus: sp.get('dataStatus') ?? undefined,
      search: sp.get('search') ?? undefined,
      sourceType: sp.get('sourceType') ?? undefined,
      assignedCampaignId: sp.get('campaignId') ?? undefined,
      assignedSdrId: sp.get('sdrId') ?? undefined,
      page: num('page'),
      pageSize: num('pageSize'),
    },
    tenantId
  );

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createPoolItemSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid pool item', details: parsed.error.flatten() }, { status: 400 });
  }

  const item = await createPoolItem({
    input: { ...parsed.data, sourceType: 'manual', sourceName: 'Manual entry' },
    actor: user,
    status: 'imported',
    qualification: 'unreviewed',
  });

  return NextResponse.json({ item }, { status: 201 });
}
