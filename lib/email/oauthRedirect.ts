import { NextResponse } from 'next/server';

/**
 * Where the email OAuth routes send the browser back to, and what they say when a connect fails.
 *
 * Behind the reverse proxy the server sees its own bind address in `req.url`
 * (`http://localhost:3000`), so `new URL('/settings', req.url)` sent the browser to a machine it
 * cannot reach — on 2026-10-05 a failed Gmail connect on crm.telestar.cloud ended on
 * `ERR_CONNECTION_REFUSED` instead of the error. The configured public origin wins; `req.url`
 * stays the fallback so local dev and tests work without it.
 */
export function publicOrigin(reqUrl: string): string {
  for (const candidate of [process.env.NEXTAUTH_URL, process.env.AUTH_URL]) {
    if (!candidate) continue;
    try {
      return new URL(candidate).origin;
    } catch {
      // Malformed: try the next source rather than fail the redirect.
    }
  }
  return new URL(reqUrl).origin;
}

export function settingsRedirect(reqUrl: string, params: Record<string, string>): NextResponse {
  const url = new URL('/settings', publicOrigin(reqUrl));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/**
 * Provider codes the Settings page explains. Anything else becomes `unknown`: the code arrives
 * from a third party and ends up in a URL the browser renders.
 */
const KNOWN_REASONS = new Set([
  'redirect_uri_mismatch',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'access_denied',
  'invalid_request',
  'invalid_scope',
  'api_not_enabled',
  'network',
]);

const API_DISABLED_REASONS = new Set(['accessNotConfigured', 'SERVICE_DISABLED']);
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN']);

export type OAuthFailure = {
  reason: string;
  status: number | null;
  description: string | null;
};

type ProviderError = {
  code?: unknown;
  message?: unknown;
  response?: { status?: unknown; data?: unknown };
};

const MAX_DESCRIPTION = 300;

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_DESCRIPTION) : null;
}

/**
 * The provider's own error code and description — read field by field. The error object itself
 * is never logged: a googleapis (gaxios) error carries the token request in `config`, client
 * secret and authorization code included.
 */
export function describeOAuthFailure(error: unknown): OAuthFailure {
  const err = (error ?? {}) as ProviderError;
  const status = typeof err.response?.status === 'number' ? err.response.status : null;
  const data = (err.response?.data ?? {}) as {
    error?: unknown;
    error_description?: unknown;
  };

  // Token endpoint: { error: 'invalid_grant', error_description: '...' }
  if (typeof data.error === 'string') {
    return {
      reason: KNOWN_REASONS.has(data.error) ? data.error : 'unknown',
      status,
      description: asText(data.error_description) ?? asText(data.error),
    };
  }

  // Google API: { error: { status, message, errors: [{ reason }] } }
  if (data.error && typeof data.error === 'object') {
    const apiError = data.error as { status?: unknown; message?: unknown; errors?: Array<{ reason?: unknown }> };
    const apiReasons = [apiError.status, ...(apiError.errors ?? []).map((e) => e?.reason)];
    const disabled = apiReasons.some((r) => typeof r === 'string' && API_DISABLED_REASONS.has(r))
      || /has not been used|is disabled/i.test(String(apiError.message ?? ''));
    return {
      reason: disabled ? 'api_not_enabled' : 'unknown',
      status,
      description: asText(apiError.message),
    };
  }

  if (typeof err.code === 'string' && NETWORK_CODES.has(err.code)) {
    return { reason: 'network', status, description: err.code };
  }

  return { reason: 'unknown', status, description: asText(err.message) };
}
