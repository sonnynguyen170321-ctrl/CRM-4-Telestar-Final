// S6c: parse a provider token-exchange response. The refresh_token is the durable
// secret (encrypted at rest, B1) used to mint access tokens for XOAUTH2 sends; we
// require it. Errors carry only the provider's error CODE — never a token.

export type OAuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number | null;
  tokenType: string;
};

export type ParseTokenResult =
  | { ok: true; tokens: OAuthTokenResponse }
  | {
      ok: false;
      reason:
        | "PROVIDER_ERROR"
        | "MISSING_ACCESS_TOKEN"
        | "MISSING_REFRESH_TOKEN"
        | "MALFORMED";
      detail?: string;
    };

export type AccessTokenResult =
  | { ok: true; accessToken: string; expiresIn: number | null }
  | { ok: false; reason: "PROVIDER_ERROR" | "MISSING_ACCESS_TOKEN" | "MALFORMED"; detail?: string };

/** Parse a refresh-grant response. A refresh grant returns a new access_token
 *  but usually NOT a new refresh_token, so we require only the access token. */
export function parseAccessTokenResponse(raw: unknown): AccessTokenResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "MALFORMED" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.error === "string") {
    return { ok: false, reason: "PROVIDER_ERROR", detail: body.error };
  }
  if (typeof body.access_token !== "string" || !body.access_token) {
    return { ok: false, reason: "MISSING_ACCESS_TOKEN" };
  }
  return {
    ok: true,
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : null,
  };
}

export function parseTokenResponse(raw: unknown): ParseTokenResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "MALFORMED" };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.error === "string") {
    // Provider error code only (e.g. "invalid_grant"); never echo tokens/secrets.
    return { ok: false, reason: "PROVIDER_ERROR", detail: body.error };
  }
  if (typeof body.access_token !== "string" || !body.access_token) {
    return { ok: false, reason: "MISSING_ACCESS_TOKEN" };
  }
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    return { ok: false, reason: "MISSING_REFRESH_TOKEN" };
  }

  return {
    ok: true,
    tokens: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: typeof body.expires_in === "number" ? body.expires_in : null,
      tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    },
  };
}
