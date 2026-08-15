import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { ProposalError, reviewProposal } from '@/lib/learning/proposals';

/**
 * A manager's decision on a playbook proposal (Phase 10).
 *
 * Approving creates a **new draft** playbook version and changes nothing that is currently in
 * force. The response says so explicitly, in the same words the confirmation dialog used, because
 * "approved" is exactly the word a reader will assume means "applied".
 *
 * Authorization is re-derived inside `reviewProposal` from the reviewer's stored role — this route
 * is not the gate, it is the door. An agent has no user row and therefore cannot pass it.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const body = await req.json().catch(() => ({}));
    const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : null;
    if (!decision) {
      return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
    }

    const result = await reviewProposal({
      tenantId: user.tenantId as string,
      proposalId: id,
      reviewerId: user.id,
      decision,
      note: typeof body.note === 'string' ? body.note : null,
    });

    return NextResponse.json({
      status: result.proposal.status,
      createdVersionId: result.createdVersionId,
      createdVersionNumber: result.createdVersionNumber,
      message:
        decision === 'approve'
          ? `Approved. Draft version ${result.createdVersionNumber} was created for review — the version currently in force is unchanged and nothing sends differently yet.`
          : 'Rejected. The proposal is closed and the evidence stays on file.',
    });
  } catch (err) {
    if (err instanceof ProposalError) {
      const status =
        err.code === 'not_found' ? 404
        : err.code === 'wrong_tenant' ? 404
        : err.code === 'reviewer_not_permitted' ? 403
        : err.code === 'reviewer_not_found' ? 403
        : 409;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return handleApiError('api/ai/proposals/[id] POST', err);
  }
}
