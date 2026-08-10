import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { dispatchWorkOrder } from '@/lib/workorders/dispatch';
import { WorkOrderConflictError } from '@/lib/workorders/conflicts';
import { WorkOrderNotFoundError, WorkOrderStateError } from '@/lib/workorders/service';

/**
 * Activate a work order and queue its execution (Revenue AI Phase 6b).
 *
 * The conflict path is the whole point of the status codes here. A refused activation returns
 * **409 with every colliding thing named** — the same contract the campaign-member impact gate
 * uses, and for the same reason: an operator told only "conflict" has to guess, and guessing
 * against live outreach is how someone cancels an SDR's sequence to get their job to run.
 *
 * Nothing is enqueued unless activation succeeded, so a 409 leaves no job behind.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  try {
    const result = await dispatchWorkOrder({
      workOrderId: id,
      tenantId: user.tenantId,
      actorUserId: user.id,
    });

    return NextResponse.json({
      workOrder: result.workOrder,
      changed: result.changed,
      jobId: result.jobId,
      slaClass: result.slaClass,
      priority: result.priority,
      playbookVersionId: result.playbookVersionId,
      leaseHeld: result.leaseHeld,
    });
  } catch (err) {
    if (err instanceof WorkOrderConflictError) {
      return NextResponse.json(
        { error: err.message, conflicts: err.conflicts },
        { status: 409 }
      );
    }
    if (err instanceof WorkOrderNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof WorkOrderStateError) {
      return NextResponse.json(
        { error: err.message, currentStatus: err.currentStatus },
        { status: 409 }
      );
    }
    return handleApiError('work-orders/dispatch', err);
  }
}
