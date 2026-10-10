import { describe, expect, it } from 'vitest';

import { TELEPHONY_ENV } from '@/lib/env-contract';
import { checkTelephonyEnv } from '@/lib/telephony/envCheck';

/**
 * The deploy gate for the dialer's variables (`scripts/prod-check-env.ts`, docs/dialer/TASKS.md D2.7).
 * Off: nothing is required. On: every Telnyx variable is, with the right shape — and no message ever
 * contains a value.
 */

// Built at runtime so the secret scanner does not mistake a fixture for a leaked key.
const SECRET_VALUE = ['never', 'echo', 'this', 'value', '0123456789'].join('-');
const PORTAL_KEY = Buffer.alloc(32, 7).toString('base64');

function enabledEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = Object.fromEntries(TELEPHONY_ENV.map((k) => [k, SECRET_VALUE]));
  env.TELNYX_PUBLIC_KEY = PORTAL_KEY;
  env.TELEPHONY_ENABLED = 'true';
  return { ...env, ...overrides };
}

const failures = (env: Record<string, string | undefined>) =>
  checkTelephonyEnv(env).filter((c) => c.level === 'FAIL').map((c) => c.message);

describe('checkTelephonyEnv', () => {
  it('requires nothing while the dialer is off', () => {
    expect(checkTelephonyEnv({})).toEqual([]);
    expect(failures({ TELEPHONY_ENABLED: 'false', TELNYX_API_KEY: SECRET_VALUE })).toEqual([]);
  });

  it('requires every Telnyx variable once enabled, naming each missing one', () => {
    expect(failures({ TELEPHONY_ENABLED: 'true' })).toEqual(TELEPHONY_ENV.map((k) => `${k} is required when TELEPHONY_ENABLED=true`));
    expect(failures(enabledEnv({ TELNYX_CALL_CONTROL_APP_ID: '  ' }))).toEqual([
      'TELNYX_CALL_CONTROL_APP_ID is required when TELEPHONY_ENABLED=true',
    ]);
  });

  it('passes a complete env, and warns when it is live rather than dry-run', () => {
    expect(checkTelephonyEnv(enabledEnv())).toEqual([{ level: 'PASS', message: expect.stringMatching(/dry-run/) }]);
    expect(checkTelephonyEnv(enabledEnv({ TELEPHONY_DRY_RUN: 'false' }))).toEqual([{ level: 'WARN', message: expect.stringMatching(/LIVE/) }]);
  });

  it('checks the shape of the auth secret, the webhook key and the balance threshold', () => {
    expect(failures(enabledEnv({ TELEPHONY_AUTH_SECRET: 'x'.repeat(31) }))).toEqual([expect.stringMatching(/TELEPHONY_AUTH_SECRET/)]);
    expect(failures(enabledEnv({ TELEPHONY_AUTH_SECRET: 'x'.repeat(32) }))).toEqual([]);
    expect(failures(enabledEnv({ TELEPHONY_AUTH_SECRET: `${'x'.repeat(40)}\n` }))).toEqual([expect.stringMatching(/TELEPHONY_AUTH_SECRET/)]);
    expect(failures(enabledEnv({ TELNYX_PUBLIC_KEY: Buffer.alloc(31).toString('base64') }))).toEqual([expect.stringMatching(/TELNYX_PUBLIC_KEY/)]);
    expect(failures(enabledEnv({ TELNYX_BALANCE_ALERT_USD: 'fifty' }))).toEqual([expect.stringMatching(/TELNYX_BALANCE_ALERT_USD/)]);
    expect(failures(enabledEnv({ TELNYX_BALANCE_ALERT_USD: '0' }))).toEqual([expect.stringMatching(/TELNYX_BALANCE_ALERT_USD/)]);
    expect(failures(enabledEnv({ TELNYX_BALANCE_ALERT_USD: '50' }))).toEqual([]);
  });

  it('checks the optional concurrency limit is a positive whole number', () => {
    for (const bad of ['0', '-4', 'forty', '12.5', '']) {
      expect(failures(enabledEnv({ TELNYX_CONCURRENCY_LIMIT: bad }))).toEqual([expect.stringMatching(/TELNYX_CONCURRENCY_LIMIT/)]);
    }
    expect(failures(enabledEnv({ TELNYX_CONCURRENCY_LIMIT: '40' }))).toEqual([]);
    expect(failures(enabledEnv())).toEqual([]);
  });

  it('rejects flag values other than exactly "true" or "false"', () => {
    expect(failures({ TELEPHONY_ENABLED: 'TRUE' })).toEqual(['TELEPHONY_ENABLED must be "true" or "false"']);
    expect(failures(enabledEnv({ TELEPHONY_DRY_RUN: 'no' }))).toEqual(['TELEPHONY_DRY_RUN must be "true" or "false"']);
  });

  it('never echoes a value', () => {
    const envs = [enabledEnv(), enabledEnv({ TELEPHONY_AUTH_SECRET: 'short' }), { TELEPHONY_ENABLED: 'false', TELNYX_API_KEY: SECRET_VALUE }];
    for (const env of envs) {
      const output = JSON.stringify(checkTelephonyEnv(env));
      expect(output).not.toContain(SECRET_VALUE);
      expect(output).not.toContain(PORTAL_KEY);
      expect(output).not.toContain('short');
    }
  });
});
