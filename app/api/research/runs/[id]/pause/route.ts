import { NextResponse } from 'next/server';

import { requireResearchRunner } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { pauseResearchRun } from '@/lib/research/runner';

/**
 * Ask a running research run to stop at the next batch boundary.
 *
 * The answer is `pause_requested`, not `paused`, for a run that is executing: the worker finishes the
 * batch in flight and then moves the run to `paused`, so the cursor is never left mid-query. The page
 * sees the status change on its next poll.
 */
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireResearchRunner();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id } = await context.params;
  const result = await pauseResearchRun({ tenantId, runId: id });

  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Research run not found' }, { status: 404 });
  }
  if (result.status === 'not_running') {
    return NextResponse.json({ error: 'This run is not running.' }, { status: 409 });
  }
  return NextResponse.json({ status: result.status });
}
