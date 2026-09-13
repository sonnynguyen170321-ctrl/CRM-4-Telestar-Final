import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUsableProviderChain } from '@telestar/core-search/search/env';

import { requireResearchRunner, requireResearchUser } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { createResearchRun } from '@/lib/research/discovery';
import { listResearchRuns } from '@/lib/research/readModel';
import { validateResearchQueryLimit } from '@/lib/research/access';

const createSchema = z.object({
  kind: z.enum(['company', 'contact']),
  icpVersionId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  queryLimit: z.number().int().positive().optional(),
  builderParams: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const user = await requireResearchUser();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const providers = resolveUsableProviderChain();
  return NextResponse.json({
    runs: await listResearchRuns(tenantId),
    providerStatus: { ready: providers.length > 0, providers },
  });
}

export async function POST(req: NextRequest) {
  // Creating a run is where the spend is committed, so it is manager-gated even though executing it
  // is the step that actually calls a provider.
  const user = await requireResearchRunner();
  if (user instanceof NextResponse) return user;

  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid run request', details: parsed.error.issues }, { status: 400 });
  }

  const limit = validateResearchQueryLimit(user.role, parsed.data.queryLimit);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `queryLimit exceeds the maximum of ${limit.max} for ${user.role}`,
        code: 'research_query_limit_exceeded',
      },
      { status: 400 },
    );
  }

  try {
    const run = await createResearchRun({
      tenantId,
      kind: parsed.data.kind,
      icpVersionId: parsed.data.icpVersionId ?? null,
      campaignId: parsed.data.campaignId ?? null,
      queryLimit: parsed.data.queryLimit,
      builderParams: (parsed.data.builderParams ?? null) as never,
      createdById: user.id,
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    // An empty ICP produces no queries, which is a bad request rather than a server fault — the
    // message names which one it was.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create run' },
      { status: 400 }
    );
  }
}
