import { createHash, randomBytes } from "node:crypto";

// S6c: PKCE (RFC 7636) for the OAuth Authorization Code flow. The code_verifier
// is a high-entropy secret kept server-side (encrypted at rest in the state
// store); only the S256 code_challenge is ever put on the authorize URL. The
// provider hashes the verifier we send at token exchange and compares — so an
// intercepted authorization code cannot be redeemed without the verifier.

export type Pkce = {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes → 43-char base64url verifier (RFC 7636 §4.1: 43–128 chars). */
export function generatePkce(): Pkce {
  const codeVerifier = base64url(randomBytes(32));
  return {
    codeVerifier,
    codeChallenge: deriveCodeChallenge(codeVerifier),
    codeChallengeMethod: "S256",
  };
}

/** S256: base64url(SHA-256(ASCII(code_verifier))). Exported for the smoke. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return base64url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

/** Opaque, unguessable state token (CSRF + replay binding). */
export function generateStateToken(): string {
  return base64url(randomBytes(32));
}
