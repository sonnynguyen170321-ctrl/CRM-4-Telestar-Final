import { NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { tenantStorage } from '@/lib/tenant-context';
import { getWhatNeedsAttention } from '@/lib/ai/engine/attention-engine';

export const dynamic = 'force-dynamic';

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
