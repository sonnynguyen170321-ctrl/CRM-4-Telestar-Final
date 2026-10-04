import { TELEPHONY_ENV } from '@/lib/env-contract';

import { MIN_AUTH_SECRET_LENGTH, isUsableAuthSecret } from './authToken';

/**
 * The deploy gate's view of the dialer's environment (`scripts/prod-check-env.ts`).
 *
 * The dialer may be off, so the Telnyx variables are optional — until `TELEPHONY_ENABLED=true`,
 * when every one is required and checked for shape. A missing variable while enabled would make
 * `isTelephonyEnabled` quietly report off; failing the deploy says why instead.
 *
 * Presence and shape only. Never echo a value, a prefix or a length.
 */

export type EnvCheck = { level: 'PASS' | 'WARN' | 'FAIL'; message: string };

const FLAG_VALUES = ['true', 'false'];
const ED25519_PUBLIC_KEY_BYTES = 32;

export function checkTelephonyEnv(env: Record<string, string | undefined>): EnvCheck[] {
  const checks: EnvCheck[] = [];
  const has = (key: string) => Boolean(env[key]?.trim());

  for (const key of ['TELEPHONY_ENABLED', 'TELEPHONY_DRY_RUN'] as const) {
    if (env[key] !== undefined && !FLAG_VALUES.includes(env[key]!)) {
      checks.push({ level: 'FAIL', message: `${key} must be "true" or "false"` });
    }
  }

  const enabled = env.TELEPHONY_ENABLED === 'true';
  if (!enabled) {
    if (TELEPHONY_ENV.some(has)) checks.push({ level: 'PASS', message: 'Telephony variables present; dialer disabled (TELEPHONY_ENABLED is not "true")' });
    return checks;
  }

  const missing = TELEPHONY_ENV.filter((key) => !has(key));
  for (const key of missing) checks.push({ level: 'FAIL', message: `${key} is required when TELEPHONY_ENABLED=true` });

  if (has('TELEPHONY_AUTH_SECRET') && !isUsableAuthSecret(env.TELEPHONY_AUTH_SECRET)) {
    checks.push({ level: 'FAIL', message: `TELEPHONY_AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters, with no surrounding whitespace` });
  }
  if (has('TELNYX_PUBLIC_KEY') && Buffer.from(env.TELNYX_PUBLIC_KEY!.trim(), 'base64').length !== ED25519_PUBLIC_KEY_BYTES) {
    checks.push({ level: 'FAIL', message: 'TELNYX_PUBLIC_KEY must be the base64 webhook public key from the Telnyx portal (32 bytes)' });
  }
  if (env.TELNYX_BALANCE_ALERT_USD !== undefined && !(Number(env.TELNYX_BALANCE_ALERT_USD) > 0)) {
    checks.push({ level: 'FAIL', message: 'TELNYX_BALANCE_ALERT_USD must be a positive number' });
  }

  if (!checks.some((check) => check.level === 'FAIL')) {
    checks.push({
      level: env.TELEPHONY_DRY_RUN === 'false' ? 'WARN' : 'PASS',
      message:
        env.TELEPHONY_DRY_RUN === 'false'
          ? 'Telephony enabled and LIVE (TELEPHONY_DRY_RUN=false): real calls will be placed'
          : 'Telephony enabled in dry-run: gate decisions are recorded, no call is placed',
    });
  }
  return checks;
}
