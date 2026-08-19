import crypto from 'node:crypto';

export interface UnsubscribePayload {
  tenantId: string;
  email: string;
  leadId?: string;
  campaignId?: string;
  timestamp?: number;
}

function getSigningSecret(requiredForSigning = false): string | null {
  const secret = process.env.AUTH_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'test') {
      return 'test-suite-unsubscribe-signing-secret-only';
    }
    if (requiredForSigning) {
      throw new Error('AUTH_SECRET or ENCRYPTION_KEY is required for unsubscribe token signing');
    }
    return null;
  }
  return secret;
}

/**
 * Generates an opaque, signed HMAC token for zero-login, secure unsubscribe.
 * Never exposes CRM database IDs directly or allows cross-tenant spoofing.
 */
export function generateUnsubscribeToken(payload: UnsubscribePayload): string {
  const secret = getSigningSecret(true)!;
  const dataWithTs: UnsubscribePayload = {
    ...payload,
    timestamp: payload.timestamp ?? Date.now(),
  };
  const data = JSON.stringify(dataWithTs);
  const dataB64 = Buffer.from(data, 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(dataB64).digest('base64url');
  return `${dataB64}.${sig}`;
}

/**
 * Verifies a signed unsubscribe token.
 * Returns decoded payload on valid HMAC, or null if tampered, malformed, or missing secret.
 */
export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  try {
    const parts = (token ?? '').trim().split('.');
    if (parts.length !== 2) return null;
    const [dataB64, sig] = parts;
    if (!dataB64 || !sig) return null;

    const secret = getSigningSecret(false);
    if (!secret) return null;

    const expectedSig = crypto.createHmac('sha256', secret).update(dataB64).digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const data = Buffer.from(dataB64, 'base64url').toString('utf-8');
    const parsed = JSON.parse(data) as UnsubscribePayload;

    if (!parsed.tenantId || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Generates RFC 8058 compliant headers for email delivery.
 */
export function buildUnsubscribeHeaders(baseUrl: string, token: string): Record<string, string> {
  const unsubUrl = `${baseUrl.replace(/\/+$/, '')}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
