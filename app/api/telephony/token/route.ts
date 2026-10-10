import { NextResponse } from 'next/server';

import { requireInteractiveUser, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TelephonyProviderError } from '@/lib/telephony/provider';
import { CredentialRevokedError, TokenRateLimitedError, issueRepToken } from '@/lib/telephony/credentials';
import { isTelephonyEnabled } from '@/lib/telephony/flags';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * A 24-hour softphone login token for the signed-in rep (docs/dialer/TECH.md).
 *
 * The browser SDK logs in with this token; the credential's password never leaves the provider.
 * Refused unless the dialer is enabled for the deployment and for this tenant, and the tenant's kill
 * switch is off. A rep can only ever get their own token: the user comes from the session.
 */
export async function POST() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });

  if (!isTelephonyEnabled(user.tenantId)) {
    return NextResponse.json({ error: 'The dialer is not enabled', code: 'dialer_disabled' }, { status: 403, headers: NO_STORE });
  }
  const settings = await prisma.telephonySettings.findFirst({
    where: { tenantId: user.tenantId },
    select: { enabled: true, killedAt: true },
  });
  if (!settings?.enabled || settings.killedAt) {
    return NextResponse.json({ error: 'The dialer is switched off for this team', code: 'dialer_disabled' }, { status: 403, headers: NO_STORE });
  }

  try {
    const token = await issueRepToken({ tenantId: user.tenantId, userId: user.id });
    return NextResponse.json(
      { token: token.token, expiresAt: token.expiresAt.toISOString(), sipUsername: token.sipUsername },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof TokenRateLimitedError) {
      return NextResponse.json({ error: 'Try again in a few seconds', code: 'rate_limited' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': '10' } });
    }
    if (error instanceof CredentialRevokedError) {
      return NextResponse.json({ error: 'Your dialer access has been revoked', code: 'credential_revoked' }, { status: 403, headers: NO_STORE });
    }
    if (error instanceof TelephonyProviderError) {
      console.error('[telephony] token request failed at the provider', { userId: user.id, status: error.status });
      return NextResponse.json({ error: 'The phone provider is not answering', code: 'provider_unavailable' }, { status: 503, headers: NO_STORE });
    }
    throw error;
  }
}
