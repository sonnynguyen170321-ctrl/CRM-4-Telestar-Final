import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireResearchManager } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { promoteCandidates } from '@/lib/research/promote';

// Promotion creates Accounts, Contacts and pool records, so it is manager-gated. It is idempotent per
// candidate, which is what makes a double-click safe.

const promoteSchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1).max(200),
});

export async function POST(req: NextRequest) {
  const user = await requireResearchManager();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = promoteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid promote request', details: parsed.error.issues }, { status: 400 });
  }

  const results = await promoteCandidates({ tenantId, actor: user, candidateIds: parsed.data.candidateIds });

  // 200 with a per-candidate breakdown: some promote, some are already promoted, some have no company
  // to attach to, and the caller needs to see which is which.
  return NextResponse.json({ results });
}
