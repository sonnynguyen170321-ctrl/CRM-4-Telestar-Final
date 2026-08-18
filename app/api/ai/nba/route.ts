import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { tenantStorage } from '@/lib/tenant-context';
import { calculateNextBestAction } from '@/lib/ai/engine/next-best-action';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const sessionUser = userOrRes as SessionUser;

  if (!sessionUser.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get('leadId');

  if (!leadId) {
    return NextResponse.json({ error: 'Missing required parameter: leadId' }, { status: 400 });
  }

  const tenantId = sessionUser.tenantId;

  try {
    const result = await tenantStorage.run(
      { tenantId, bypassRls: true },
      async () => {
        return await calculateNextBestAction({
          leadId,
          tenantId,
        });
      }
    );

    if (!result) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to calculate next best action' },
      { status: 500 }
    );
  }
}
