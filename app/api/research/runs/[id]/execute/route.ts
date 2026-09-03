import { NextRequest, NextResponse } from 'next/server';

import { requireResearchManager } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { DISCOVERY_QUERY_BATCH, runDiscoveryPass } from '@/lib/research/discovery';

// Runs one bounded pass and reports where the run got to.
//
// Bounded on purpose: a 1000-query run inside one request would hold a connection for minutes and die
// to any proxy timeout. The response carries `finished`, so the caller keeps calling until it is true
// — the same shape a queue consumer would have, without adding a queue for something no automation
// enqueues yet.

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireResearchManager();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const { id } = await context.params;
  const requested = Number(new URL(req.url).searchParams.get('maxQueries') ?? DISCOVERY_QUERY_BATCH);

  try {
    const result = await runDiscoveryPass({
      tenantId,
      runId: id,
      maxQueries: Number.isFinite(requested) ? requested : DISCOVERY_QUERY_BATCH,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Discovery pass failed' },
      { status: 400 }
    );
  }
}
