import 'server-only';

import type { TelephonyProvider } from './provider';
import { TelnyxProvider } from './telnyx/client';
import { isTelephonyConfigured } from './flags';

/**
 * The provider the app uses. Tests replace it with `setTelephonyProviderForTests(new FakeTelephonyProvider())`;
 * nothing else should construct a provider.
 */

let override: TelephonyProvider | null = null;

export function setTelephonyProviderForTests(provider: TelephonyProvider | null): void {
  override = provider;
}

export function getTelephonyProvider(): TelephonyProvider {
  if (override) return override;
  if (!isTelephonyConfigured()) throw new Error('Telephony is not configured (see lib/env-contract.ts TELEPHONY_ENV)');
  return new TelnyxProvider({
    apiKey: process.env.TELNYX_API_KEY!,
    credentialConnectionId: process.env.TELNYX_CREDENTIAL_CONNECTION_ID!,
    // Optional, comma-separated host suffixes recordings may be downloaded from (see telnyx/client.ts).
    recordingHosts: (process.env.TELEPHONY_RECORDING_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
  });
}
