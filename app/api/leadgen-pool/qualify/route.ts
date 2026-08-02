import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolUser } from '@/app/api/leadgen-pool/guard';
import { qualifyPoolItems } from '@/lib/leadgen/pool';

const qualifySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  qualification: z.enum(['qualified', 'disqualified', 'needs_research', 'invalid_contact', 'invalid_company', 'out_of_icp']),
  reason: z.string().optional(),
  qaNotes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requirePoolUser();
  if (user instanceof NextResponse) return user;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = qualifySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid qualify request', details: parsed.error.flatten() }, { status: 400 });
  }

  const tenantId = user.tenantId || 'default-tenant';
  const result = await qualifyPoolItems({
    itemIds: parsed.data.ids,
    qualification: parsed.data.qualification,
    reason: parsed.data.reason,
    qaNotes: parsed.data.qaNotes,
    actor: user,
    tenantId,
  });

  return NextResponse.json(result);
}
