import { NextResponse } from 'next/server';

import { requireResearchRunner } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { ResearchRunnerUnavailableError, startResearchRun } from '@/lib/research/runner';

/**
 * Start or resume a research run on the background worker.
 *
 * This used to run one ten-query pass inside the request and leave the browser to call again until
 * `finished` — which made the tab the runner. The run now belongs to the `research` queue: this
 * claims it and returns 202, and the page only watches. Leaving the page no longer stops anything.
 *
 * Calling it again while the run is going is harmless: the claim in `startResearchRun` matches only
 * a run nobody is working, so a second click, a second tab and a retried request all get
 * `already_running` and queue nothing.
 */
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireResearchRunner();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id } = await context.params;

  try {
    const result = await startResearchRun({ tenantId, runId: id });
    switch (result.status) {
      case 'not_found':
        return NextResponse.json({ error: 'Research run not found' }, { status: 404 });
      case 'already_finished':
        return NextResponse.json(
          { error: `This run has already ${result.runStatus === 'failed' ? 'failed' : 'finished'}.` , status: result.runStatus },
          { status: 409 }
        );
      case 'already_running':
        return NextResponse.json({ status: 'running', alreadyRunning: true }, { status: 202 });
      case 'started':
        return NextResponse.json({ status: 'running', alreadyRunning: false }, { status: 202 });
    }
  } catch (error) {
    if (error instanceof ResearchRunnerUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error('[api/research/runs/execute] failed to start run', { runId: id, error });
    return NextResponse.json({ error: 'Could not start the research run' }, { status: 500 });
  }
}
