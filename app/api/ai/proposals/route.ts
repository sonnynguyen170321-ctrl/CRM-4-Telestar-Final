import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { collectOutcomeSignals } from '@/lib/learning/collect';
import { buildProposals, canReviewProposals, listProposals } from '@/lib/learning/proposals';

/**
 * Playbook proposals — read the queue, or rebuild it from the evidence (Phase 10).
 *
 * `GET` is readable by anyone who can see the AI surfaces; `canReview` tells the client whether to
 * offer the decision buttons, and the decision route enforces it again regardless of what the
 * client believed.
 *
 * `POST` re-runs collection and proposal building. It writes evidence and proposals and **nothing
 * else** — no playbook, no version, no policy. It is deliberately a human-triggered refresh rather
 * than a background job: a proposal appearing while nobody asked for it is the shape of a system
 * that later changes something while nobody asked for it.
 */
export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const proposals = await listProposals(user.tenantId as string);
    return NextResponse.json({ proposals, canReview: canReviewProposals(user.role) });
  } catch (err) {
    return handleApiError('api/ai/proposals GET', err);
  }
}

export async function POST(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // Rebuilding is a manager action. It cannot change policy, but it does decide what lands in a
  // manager's decision queue, and that queue belongs to the people who have to work it.
  if (!canReviewProposals(user.role)) {
    return NextResponse.json({ error: 'Only a Director or Floor Manager can rebuild proposals' }, { status: 403 });
  }

  try {
    const tenantId = user.tenantId as string;
    const collection = await collectOutcomeSignals(tenantId);
    const built = await buildProposals(tenantId);
    return NextResponse.json({
      signals: { scanned: collection.scanned, recorded: collection.recorded, byKind: collection.byKind },
      proposals: { created: built.created, updated: built.updated },
      canReview: true,
    });
  } catch (err) {
    return handleApiError('api/ai/proposals POST', err);
  }
}
