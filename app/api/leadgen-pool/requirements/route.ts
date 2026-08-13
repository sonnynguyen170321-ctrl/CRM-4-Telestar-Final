import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { createRequirement, listRequirements, type RequirementInput } from '@/lib/leadgen/requirements';
import { requireTenantId } from '@/lib/api/tenant';

const requirementSchema = z.object({
  campaignId: z.string().min(1),
  requiredCount: z.number().int().min(1),
  targetTitles: z.array(z.string()).optional(),
  targetCountries: z.array(z.string()).optional(),
  targetIndustries: z.array(z.string()).optional(),
  companySizeMin: z.number().nullable().optional(),
  companySizeMax: z.number().nullable().optional(),
  requiredFields: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(['open', 'fulfilled', 'paused', 'cancelled']).optional(),
});

export async function GET(req: NextRequest) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const campaignId = req.nextUrl.searchParams.get('campaignId') ?? undefined;
  return NextResponse.json(await listRequirements(tenantId, campaignId));
}

export async function POST(req: NextRequest) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = requirementSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid requirement', details: parsed.error.flatten() }, { status: 400 });
  }

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const created = await createRequirement({
    input: parsed.data as RequirementInput,
    actor: user,
    tenantId,
  });

  return NextResponse.json({ requirement: created }, { status: 201 });
}
