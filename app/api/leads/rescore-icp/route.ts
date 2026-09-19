import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth, type SessionUser } from '@/lib/auth';
import { canManageScoringRequest } from '@/lib/leads/scoringAccess';
import { rescoreLeadsIcp, RESCORE_LEADS_BATCH_LIMIT } from '@/lib/leads/icpScoring';
import { parseBody } from '@/lib/validation/core';
import { tenantStorage } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

/**
 * Score CRM leads against their campaign ICP, in bounded batches.
 *
 * The lead-side twin of `POST /api/leadgen-pool/rescore`. It exists for two moments: the
 * backfill of every lead that was created before leads could carry an ICP verdict at all
 * (`onlyUnscored`, the default), and the re-run after a manager publishes a new rule set
 * (`onlyUnscored: false`), where the fingerprint makes every unchanged lead free.
 *
 * Bounded to `RESCORE_LEADS_BATCH_LIMIT` per call and reports `truncated`, so a tenant with
 * thousands of leads is scored by repeating the call, not by a request that runs until the
 * proxy gives up on it.
 */
const rescoreSchema = z.object({
  campaignId: z.string().min(1).max(64).optional(),
  onlyUnscored: z.boolean().optional(),
  limit: z.number().int().min(1).max(RESCORE_LEADS_BATCH_LIMIT).optional(),
});

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  if (!canManageScoringRequest(user)) {
    return NextResponse.json({ error: 'Forbidden: manager role and scoring:write scope required' }, { status: 403 });
  }

  const parsed = await parseBody(req, rescoreSchema, 'Invalid rescore request');
  if (parsed.error) return parsed.error;
  const tenantId = user.tenantId;

  try {
    const report = await tenantStorage.run({ tenantId }, () =>
      rescoreLeadsIcp({ tenantId, campaignId: parsed.data.campaignId, onlyUnscored: parsed.data.onlyUnscored, limit: parsed.data.limit })
    );
    return NextResponse.json({ success: true, ...report });
  } catch (err) {
    console.error('[leads/rescore-icp] failed:', err);
    return NextResponse.json({ error: 'Rescore failed' }, { status: 500 });
  }
}
