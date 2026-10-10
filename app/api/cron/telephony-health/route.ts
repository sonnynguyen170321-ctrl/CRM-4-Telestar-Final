import { NextRequest, NextResponse } from 'next/server';

import { authorizeCronRequest } from '@/lib/cron/auth';
import { recordCronHeartbeat } from '@/lib/ops/cronHeartbeat';
import { runTelephonyHealth } from '@/lib/telephony/health';

export const dynamic = 'force-dynamic';

/**
 * Dialer health, every five minutes (docs/dialer/TASKS.md D9.1): provider balance, failure rate,
 * webhook silence, event backlog and concurrency, each reported to ops through `notifyOps` with its
 * own cooldown. See `lib/telephony/health.ts` for the thresholds.
 *
 * The scheduler (CRON_SECRET bearer) only. The checks look across every team, so a signed-in
 * manager's manual run is refused rather than narrowed.
 */
export async function GET(req: NextRequest) {
  const authz = await authorizeCronRequest(req);
  if (!authz) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (authz.scope !== 'platform') return NextResponse.json({ error: 'Platform scheduler only' }, { status: 403 });

  const { findings, notified } = await runTelephonyHealth();
  await recordCronHeartbeat('telephony-health', 'system');
  return NextResponse.json({ findings, notified });
}
