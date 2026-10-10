import { NextRequest, NextResponse } from 'next/server';

import { authorizeCronRequest } from '@/lib/cron/auth';
import { recordCronHeartbeat } from '@/lib/ops/cronHeartbeat';
import { reconcileTelephony } from '@/lib/telephony/reconcile';

export const dynamic = 'force-dynamic';

/**
 * Dialer reconciliation, every five minutes (docs/dialer/TASKS.md D4.4): replays provider events
 * nobody processed, cancels authorized calls that never reached the provider, and finishes calls
 * the provider no longer has. See `lib/telephony/reconcile.ts` for the rules and batch bounds.
 *
 * The scheduler (CRON_SECRET bearer) reaches every tenant; a signed-in manager's manual run
 * reaches their own tenant only — see lib/cron/auth.ts.
 */
export async function GET(req: NextRequest) {
  const authz = await authorizeCronRequest(req);
  if (!authz) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const summary = await reconcileTelephony({ tenantIds: authz.scope === 'tenant' ? [authz.tenantId] : null });
  if (authz.scope === 'platform') await recordCronHeartbeat('telephony-reconcile', 'system');
  return NextResponse.json(summary);
}
