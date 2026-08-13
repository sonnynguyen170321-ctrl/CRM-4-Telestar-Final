import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { convertPoolToLeads } from '@/lib/leadgen/pool';
import { canAssignToRep } from '@/lib/leadgen/assignableReps';
import { requireTenantId } from '@/lib/api/tenant';

const convertSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  campaignId: z.string().min(1),
  sdrIds: z.array(z.string().min(1)).min(1),
  method: z.enum(['single', 'round_robin']).default('single'),
});

export async function POST(req: NextRequest) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = convertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid convert request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, campaignId, sdrIds, method } = parsed.data;
  // Scoped by campaign assignment, not by the manager's reporting subtree — a
  // leadgen manager has no SDRs beneath them, so canAccessUser rejected every
  // valid target. See lib/leadgen/assignableReps.ts.
  for (const sdrId of sdrIds) {
    if (!(await canAssignToRep(user, sdrId, campaignId))) {
      return NextResponse.json({ error: `Forbidden: cannot assign to user ${sdrId}` }, { status: 403 });
    }
  }

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const result = await convertPoolToLeads({
    itemIds: ids,
    campaignId,
    sdrIds,
    method,
    actor: user,
    tenantId,
  });

  return NextResponse.json(result);
}
