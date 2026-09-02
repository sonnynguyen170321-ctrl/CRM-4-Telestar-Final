import { getOAuthProviderConfig, type OAuthProvider } from "./providers";
import { parseAccessTokenResponse } from "./tokens";

// S6d: mint a short-lived access token from the stored (decrypted) refresh token,
// for XOAUTH2 SMTP send + IMAP. The refresh token + client secret stay
// server-side; only the bearer access token is handed to the transport, and only
// for the duration of the connection. Errors carry a fixed reason, never a token.

type Env = NodeJS.ProcessEnv;

function providerCreds(provider: OAuthProvider, env: Env) {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  return {
    clientId: env[`${prefix}_OAUTH_CLIENT_ID`] ?? "",
    clientSecret: env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "",
  };
}

export type MintAccessTokenResult =
  | { ok: true; accessToken: string; expiresIn: number | null }
  | { ok: false; reason: "PROVIDER_NOT_CONFIGURED" | "REFRESH_FAILED" };

export async function mintAccessToken(input: {
  provider: OAuthProvider;
  refreshToken: string;
  env?: Env;
  fetchImpl?: typeof fetch;
}): Promise<MintAccessTokenResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const creds = providerCreds(input.provider, env);
  if (!creds.clientId || !creds.clientSecret) {
    return { ok: false, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  let json: unknown;
  try {
    const res = await fetchImpl(getOAuthProviderConfig(input.provider).tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }).toString(),
    });
    json = await res.json();
  } catch {
    return { ok: false, reason: "REFRESH_FAILED" };
  }

  const parsed = parseAccessTokenResponse(json);
  if (!parsed.ok) {
    return { ok: false, reason: "REFRESH_FAILED" };
  }
  return { ok: true, accessToken: parsed.accessToken, expiresIn: parsed.expiresIn };
}

/** XOAUTH2 auth object shape for nodemailer (SMTP) and imapflow (IMAP). */
export function buildXoauth2Auth(user: string, accessToken: string) {
  return { user, accessToken };
}
