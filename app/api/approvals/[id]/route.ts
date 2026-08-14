import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import {
  ApprovalError,
  approveRequest,
  rejectRequest,
  resumeApprovedAction,
} from '@/lib/workorders/approvals';
import { StepCopyRefusedError } from '@/lib/sequences/stepCopy';

/**
 * Decide one agent approval request (Revenue AI Phase 6b).
 *
 * Approving does **not** execute anything, and the response says so explicitly. It records a
 * decision and then re-derives authorization to report whether the action could run *right now* —
 * which is a different question, and one whose answer can be no even a second after a human said
 * yes. Execution happens when the work order is re-dispatched, and re-derives authorization
 * again at that point.
 *
 * That indirection is the design, not an inconvenience. An endpoint that approved-and-executed
 * in one step would make the approval a permission token, and the whole point of storing the
 * decision instead is that a lead reassigned, a policy tightened or a playbook superseded
 * between the click and the run must still be able to refuse.
 *
 * ## Approving with an edit
 *
 * `approvedCopy` on an `approve` is the reviewer's own wording for a personalized cadence, and it
 * replaces the drafted copy in the same statement that records the decision. Shape checking is
 * left to `parseApprovedCopy` rather than duplicated in zod: it is the same validation the launch
 * and the agent tool run, so an edit accepted here cannot be one the launch would later refuse.
 */
const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(2000).optional(),
  approvedCopy: z.unknown().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  try {
    const parsed = decisionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (parsed.data.decision === 'reject') {
      const request = await rejectRequest({
        requestId: id,
        tenantId: user.tenantId,
        approver: user,
        reason: parsed.data.reason,
      });
      return NextResponse.json({ approval: request, executable: false });
    }

    const request = await approveRequest({
      requestId: id,
      tenantId: user.tenantId,
      approver: user,
      reason: parsed.data.reason,
      // `undefined` means "approve what was drafted". An omitted field and an edit are different
      // intents, so the absent case must not collapse into an empty edit.
      editedCopy: 'approvedCopy' in parsed.data ? parsed.data.approvedCopy : undefined,
    });

    // Report whether it would be permitted now. Informational: the executing worker re-runs this
    // same check against the state at execution time, and may still refuse.
    const resume = await resumeApprovedAction({
      requestId: id,
      tenantId: user.tenantId,
      actor: user,
    });

    return NextResponse.json({
      approval: request,
      executable: resume.status === 'proceed',
      ...(resume.status === 'refused'
        ? { blockedBy: resume.reason, detail: resume.detail }
        : {}),
    });
  } catch (err) {
    // A malformed edit is the caller's mistake, not a conflict: it never reached the decision.
    if (err instanceof StepCopyRefusedError) {
      return NextResponse.json({ error: err.message, code: 'invalid_copy' }, { status: 400 });
    }
    if (err instanceof ApprovalError) {
      const status =
        err.code === 'not_found'
          ? 404
          : err.code === 'approver_not_permitted'
            ? 403
            : err.code === 'edit_not_supported'
              ? 400
              : 409;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return handleApiError('approvals/decide', err);
  }
}
