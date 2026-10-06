import { NextResponse } from 'next/server';
import { requireAuth, getLeadWhereScope, type SessionUser } from '@/lib/auth';
import { tenantStorage } from '@/lib/tenant-context';
import { getWhatNeedsAttention } from '@/lib/ai/engine/attention-engine';

export const dynamic = 'force-dynamic';

const MANAGER_ATTENTION_ROLES = new Set(['director', 'floor_manager', 'team_lead']);

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const sessionUser = userOrRes as SessionUser;

  if (!sessionUser.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const tenantId = sessionUser.tenantId;

  try {
    const report = await tenantStorage.run(
      { tenantId, bypassRls: true },
      async () => {
        return await getWhatNeedsAttention({
          userId: sessionUser.id,
          role: sessionUser.role,
          tenantId,
          // Only the manager roles see the leads-nobody-works count, so only they pay for the scope.
          leadScope: MANAGER_ATTENTION_ROLES.has(sessionUser.role) ? await getLeadWhereScope(sessionUser) : undefined,
        });
      }
    );

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate attention report' },
      { status: 500 }
    );
  }
}
