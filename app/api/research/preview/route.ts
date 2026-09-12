import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireResearchRunner } from '@/app/api/research/guard';
import { requireTenantId } from '@/lib/api/tenant';
import { validateResearchQueryLimit } from '@/lib/research/access';
import { planResearchRunQueries } from '@/lib/research/discovery';

const previewSchema = z
  .object({
    kind: z.enum(['company', 'contact']),
    icpVersionId: z.string().min(1).optional(),
    queryLimit: z.number().int().positive().optional(),
    builderParams: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Return the exact deterministic query plan without creating a run or calling a provider.
 * The response is deliberately capped to ten samples while total preserves the real plan size.
 */
export async function POST(req: NextRequest) {
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

  const parsed = previewSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid preview request', details: parsed.error.issues },
      { status: 400 },
    );
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
    const queries = await planResearchRunQueries({
      tenantId,
      kind: parsed.data.kind,
      icpVersionId: parsed.data.icpVersionId ?? null,
      queryLimit: parsed.data.queryLimit,
      builderParams: (parsed.data.builderParams ?? null) as never,
    });
    return NextResponse.json({ total: queries.length, queries: queries.slice(0, 10) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not preview queries' },
      { status: 400 },
    );
  }
}
