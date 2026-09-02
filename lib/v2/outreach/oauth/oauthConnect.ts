import "server-only";

import { prisma } from "@/lib/server/prisma";
import { encryptSecret, decryptSecret, loadMasterKey } from "../credentials/encryption";
import { encryptSenderAuth } from "../credentials/credentialLoader";
import { buildAuthorizeUrl } from "./authorizeUrl";
import { createOAuthState } from "./state";
import { getOAuthProviderConfig, type OAuthProvider } from "./providers";
import { parseTokenResponse } from "./tokens";

// S6c-runtime: the server side of the OAuth Authorization Code + PKCE connect.
// Secrets (client secret, PKCE verifier, refresh token) live only server-side
// and are encrypted at rest; nothing is logged.

type Env = NodeJS.ProcessEnv;

function providerCreds(provider: OAuthProvider, env: Env) {
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  return {
    clientId: env[`${prefix}_OAUTH_CLIENT_ID`] ?? "",
    clientSecret: env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "",
  };
}

export type StartOAuthResult =
  | { ok: true; url: string }
  | { ok: false; reason: "PROVIDER_NOT_CONFIGURED" | "NO_MASTER_KEY" };

export async function startOAuthConnect(input: {
  organizationId: string;
  provider: OAuthProvider;
  createdByUserId: string;
  redirectUri: string;
  env?: Env;
}): Promise<StartOAuthResult> {
  const env = input.env ?? process.env;
  const creds = providerCreds(input.provider, env);
  if (!creds.clientId || !creds.clientSecret) {
    return { ok: false, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  let key: Buffer;
  try {
    key = loadMasterKey(env);
  } catch {
    return { ok: false, reason: "NO_MASTER_KEY" };
  }

  const st = createOAuthState();
  await prisma.v2OutreachOAuthState.create({
    data: {
      organizationId: input.organizationId,
      state: st.state,
      provider: input.provider,
      codeVerifierEnc: encryptSecret(st.codeVerifier, key) as unknown as object,
      redirectUri: input.redirectUri,
      createdByUserId: input.createdByUserId,
      expiresAt: st.expiresAt,
    },
  });

  return {
    ok: true,
    url: buildAuthorizeUrl({
      provider: input.provider,
      clientId: creds.clientId,
      redirectUri: input.redirectUri,
      state: st.state,
      codeChallenge: st.codeChallenge,
    }),
  };
}

export type CompleteOAuthResult =
  | { ok: true; senderId: string; email: string; created: boolean }
  | {
      ok: false;
      reason:
        | "INVALID_STATE"
        | "PROVIDER_NOT_CONFIGURED"
        | "TOKEN_EXCHANGE_FAILED"
        | "NO_EMAIL"
        | "NO_MASTER_KEY";
      detail?: string;
    };

export async function completeOAuthConnect(input: {
  organizationId: string;
  provider: OAuthProvider;
  code: string;
  state: string;
  env?: Env;
  fetchImpl?: typeof fetch;
}): Promise<CompleteOAuthResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const creds = providerCreds(input.provider, env);
  if (!creds.clientId || !creds.clientSecret) {
    return { ok: false, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  let key: Buffer;
  try {
    key = loadMasterKey(env);
  } catch {
    return { ok: false, reason: "NO_MASTER_KEY" };
  }

  // Atomic single-use consume: only an unconsumed, unexpired, tenant+provider
  // matching state row is claimed. Concurrent callbacks cannot both win.
  const claimed = await prisma.$queryRawUnsafe<
    Array<{ codeVerifierEnc: unknown; redirectUri: string }>
  >(
    `UPDATE "V2OutreachOAuthState"
       SET "consumedAt" = CURRENT_TIMESTAMP
     WHERE "organizationId" = $1 AND "state" = $2 AND "provider" = $3
       AND "consumedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP
     RETURNING "codeVerifierEnc", "redirectUri"`,
    input.organizationId,
    input.state,
    input.provider
  );
  const row = claimed[0];
  if (!row) {
    return { ok: false, reason: "INVALID_STATE" };
  }

  const codeVerifier = decryptSecret(row.codeVerifierEnc as never, key);
  const config = getOAuthProviderConfig(input.provider);

  let tokenJson: unknown;
  try {
    const res = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: codeVerifier,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: row.redirectUri,
      }).toString(),
    });
    tokenJson = await res.json();
  } catch {
    return { ok: false, reason: "TOKEN_EXCHANGE_FAILED" };
  }

  const parsed = parseTokenResponse(tokenJson);
  if (!parsed.ok) {
    // detail is a provider error CODE only (parseTokenResponse guarantees no token).
    return { ok: false, reason: "TOKEN_EXCHANGE_FAILED", detail: parsed.reason };
  }

  const email = emailFromIdToken((tokenJson as { id_token?: unknown }).id_token);
  if (!email) {
    return { ok: false, reason: "NO_EMAIL" };
  }

  const refreshEnc = encryptSecret(parsed.tokens.refreshToken, key);
  const senderId = await upsertOAuthSender({
    organizationId: input.organizationId,
    provider: input.provider,
    email,
    refreshEnc,
    config,
    createdByUserId: null,
  });

  return { ok: true, senderId: senderId.id, email, created: senderId.created };
}

/** Decode (not verify) the id_token payload to read the connected mailbox email.
 *  We only trust it to label the sender the admin themselves just authorized. */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string" || idToken.split(".").length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")
    ) as { email?: unknown; preferred_username?: unknown };
    const email = payload.email ?? payload.preferred_username;
    return typeof email === "string" && email.includes("@") ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function upsertOAuthSender(input: {
  organizationId: string;
  provider: OAuthProvider;
  email: string;
  refreshEnc: object;
  config: ReturnType<typeof getOAuthProviderConfig>;
  createdByUserId: string | null;
}): Promise<{ id: string; created: boolean }> {
  const domain = input.email.split("@")[1] ?? input.email;
  // OAuth senders never use a password; smtpAuthEnc holds an inert placeholder so
  // the NOT NULL column is satisfied — the send path uses oauthRefreshEnc (XOAUTH2).
  const smtpAuthEnc = encryptSenderAuth({ user: input.email, pass: "__OAUTH__" });

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2SenderAccount"
     WHERE "organizationId" = $1 AND "fromAddress" = $2 AND "deletedAt" IS NULL LIMIT 1`,
    input.organizationId,
    input.email
  );

  if (existing[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE "V2SenderAccount"
         SET "authMode" = 'OAUTH', "oauthProvider" = $3, "oauthRefreshEnc" = $4::jsonb,
             "verifiedAt" = CURRENT_TIMESTAMP, "lastVerifyError" = NULL,
             "lastVerifyCheckedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "organizationId" = $2`,
      existing[0].id,
      input.organizationId,
      input.provider,
      JSON.stringify(input.refreshEnc)
    );
    return { id: existing[0].id, created: false };
  }

  const id = `snd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2SenderAccount"
       ("id","organizationId","kind","displayName","fromAddress","domain",
        "smtpHost","smtpPort","smtpSecure","smtpAuthEnc",
        "imapHost","imapPort","imapSecure",
        "authMode","oauthProvider","oauthRefreshEnc",
        "dailyCapTarget","status","liveSendEnabled",
        "verifiedAt","lastVerifyCheckedAt","createdByUserId","createdAt","updatedAt")
     VALUES ($1,$2,'MAILBOX',$3,$4,$5,
        $6,$7,$8,$9::jsonb,
        $10,$11,$12,
        'OAUTH',$13,$14::jsonb,
        0,'ACTIVE',false,
        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$15,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id,
    input.organizationId,
    input.email,
    input.email,
    domain,
    input.config.smtpHost,
    input.config.smtpPort,
    input.config.smtpSecure,
    JSON.stringify(smtpAuthEnc),
    input.config.imapHost,
    input.config.imapPort,
    input.config.imapSecure,
    input.provider,
    JSON.stringify(input.refreshEnc),
    input.createdByUserId
  );
  return { id, created: true };
}
