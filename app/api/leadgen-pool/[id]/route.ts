import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { enrichPoolItem } from '@/lib/leadgen/pool';
import { prisma } from '@/lib/prisma';
import { logLeadgenActivity } from '@/lib/leadgen/pool';

const patchSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  company: z.string().optional(),
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid patch', details: parsed.error.flatten() }, { status: 400 });
  }

  const tenantId = user.tenantId || 'default-tenant';
  const updated = await enrichPoolItem({ id, patch: parsed.data, actor: user, tenantId });
  if (!updated) {
    return NextResponse.json({ error: 'Pool item not found' }, { status: 404 });
  }

  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const tenantId = user.tenantId || 'default-tenant';
  const existing = await prisma.leadPoolItem.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Pool item not found' }, { status: 404 });
  }

  await prisma.leadPoolItem.update({
    where: { id },
    data: { status: 'archived' },
  });
  await logLeadgenActivity({
    actor: user,
    type: 'archived',
    poolItemId: id,
    description: 'Archived pool record',
  });

  return NextResponse.json({ success: true });
}
