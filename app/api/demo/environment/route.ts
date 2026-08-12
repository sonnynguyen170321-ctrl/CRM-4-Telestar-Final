import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { isDryRun, isAutosendEnabled } from '@/lib/emailSafety';

/**
 * What environment am I presenting in, and can this thing email a real person?
 *
 * Read-only, authenticated, and deliberately tiny: two booleans and the tenant id the session
 * already carries. The header badge it feeds exists so a presenter never has to take it on faith
 * that the demo tenant is isolated and that nothing is leaving the building.
 *
 * It reports the send safeguards; it does not set them. `lib/emailSafety.ts` remains the only
 * place that decides, and the worker remains the only place that acts on the decision.
 */

const DEMO_TENANT_ID = 'demo-telestar';

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    return NextResponse.json({
      tenantId: user.tenantId ?? null,
      isDemoTenant: user.tenantId === DEMO_TENANT_ID,
      emailDryRun: isDryRun(),
      autosendEnabled: isAutosendEnabled(),
    });
  } catch (err) {
    return handleApiError('api/demo/environment GET', err);
  }
}
