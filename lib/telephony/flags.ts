import { isDemoTenant } from '@/lib/emailSafety';
import { TELEPHONY_ENV } from '@/lib/env-contract';

import { isUsableAuthSecret } from './authToken';

/**
 * Deployment-level switches for the dialer, mirroring lib/emailSafety.ts.
 *
 * Three independent conditions, all required before anyone can dial:
 *   - configured: every Telnyx variable is present (and the signing secret long enough);
 *   - enabled:    `TELEPHONY_ENABLED` is exactly "true" (anything else is off);
 *   - not demo:   demo and presentation tenants never dial.
 * Dry-run is on unless `TELEPHONY_DRY_RUN` is exactly "false": gate decisions are recorded, no call
 * is placed. Per-tenant settings (TelephonySettings.enabled, the kill switch) come on top of these.
 */

/** Missing, or present but unusable: a short signing secret is as good as none. */
export function missingTelephonyEnv(): string[] {
  return TELEPHONY_ENV.filter((key) => {
    if (key === 'TELEPHONY_AUTH_SECRET') return !isUsableAuthSecret(process.env[key]);
    return !process.env[key]?.trim();
  });
}

export function isTelephonyConfigured(): boolean {
  return missingTelephonyEnv().length === 0;
}

export function isTelephonyEnabled(tenantId?: string | null): boolean {
  if (process.env.TELEPHONY_ENABLED !== 'true') return false;
  if (!isTelephonyConfigured()) return false;
  if (isDemoTenant(tenantId)) return false;
  return true;
}

export function isTelephonyDryRun(tenantId?: string | null): boolean {
  if (isDemoTenant(tenantId)) return true;
  return process.env.TELEPHONY_DRY_RUN !== 'false';
}
