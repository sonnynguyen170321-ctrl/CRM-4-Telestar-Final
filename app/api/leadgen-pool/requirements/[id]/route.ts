import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { deleteRequirement, updateRequirement, type RequirementInput } from '@/lib/leadgen/requirements';
import { requireTenantId } from '@/lib/api/tenant';

const requirementPatchSchema = z
  .object({
    campaignId: z.string().min(1).optional(),
    requiredCount: z.number().int().min(1).optional(),
    targetTitles: z.array(z.string()).optional(),
    targetCountries: z.array(z.string()).optional(),
    targetIndustries: z.array(z.string()).optional(),
    companySizeMin: z.number().nullable().optional(),
    companySizeMax: z.number().nullable().optional(),
    requiredFields: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    status: z.enum(['open', 'fulfilled', 'paused', 'cancelled']).optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = requirementPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid requirement', details: parsed.error.flatten() }, { status: 400 });
  }

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const updated = await updateRequirement({
    id,
    input: parsed.data as Partial<RequirementInput>,
    tenantId,
  });
  if (!updated) {
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
  }

  return NextResponse.json({ requirement: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const ok = await deleteRequirement(id, tenantId);
  if (!ok) {
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
