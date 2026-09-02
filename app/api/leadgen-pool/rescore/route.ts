import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { RESCORE_BATCH_LIMIT, rescorePool } from '@/lib/leadgen/rescorePool';

// Re-score existing pool records against the current ICP.
//
// Manager-only: it rewrites the score every routing decision downstream reads, and it costs a pass
// over up to `RESCORE_BATCH_LIMIT` records. Nothing is destroyed — each run appends an assessment
// and moves the pointer — but the numbers a floor sees do change.

const rescoreSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ids'), ids: z.array(z.string().min(1)).min(1).max(RESCORE_BATCH_LIMIT) }),
  z.object({ kind: z.literal('campaign'), campaignId: z.string().min(1) }),
  // The common case after an ICP is configured for the first time: everything that landed before it
  // existed is sitting NOT SCORED.
  z.object({ kind: z.literal('unscored') }),
]);

export async function POST(req: NextRequest) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = rescoreSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid rescore request', details: parsed.error.issues }, { status: 400 });
  }

  const result = await rescorePool({ tenantId, selection: parsed.data });

  // 200 even with failures in the array: the batch ran, and the caller needs the breakdown rather
  // than a status code that hides which records moved.
  return NextResponse.json(result);
}
