import { generatePkce } from "./pkce";
import { generateStateToken } from "./pkce";
import type { OAuthProvider } from "./providers";

// S6c: one-time, tenant-bound OAuth state. The state token is generated server
// side, persisted with the PKCE verifier (encrypted at rest by the store), and
// must be consumed exactly once by the SAME organization before it expires. This
// is the CSRF + replay + cross-tenant defense for the callback.

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type OAuthStateRecord = {
  state: string;
  organizationId: string;
  provider: OAuthProvider;
  codeVerifier: string; // the store decrypts this before validation
  redirectUri: string;
  expiresAt: Date | string;
  consumedAt: Date | string | null;
};

export type NewOAuthState = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  expiresAt: Date;
};

/** Build the fields for a new state row (the caller persists + encrypts verifier). */
export function createOAuthState(now: Date = new Date(), ttlMs: number = DEFAULT_TTL_MS): NewOAuthState {
  const pkce = generatePkce();
  return {
    state: generateStateToken(),
    codeVerifier: pkce.codeVerifier,
    codeChallenge: pkce.codeChallenge,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

export type ConsumeStateInput = {
  state: string;
  organizationId: string;
  now?: Date;
};

export type ConsumeStateResult =
  | { ok: true; record: OAuthStateRecord }
  | {
      ok: false;
      reason: "STATE_MISMATCH" | "TENANT_MISMATCH" | "ALREADY_USED" | "EXPIRED";
    };

/**
 * Pure validation of a loaded state record against the callback inputs. The
 * store is responsible for the atomic single-use mark (e.g. UPDATE ... WHERE
 * consumedAt IS NULL RETURNING) so two concurrent callbacks cannot both pass —
 * this function is the policy, the store enforces atomicity.
 */
export function validateOAuthState(
  record: OAuthStateRecord | null,
  input: ConsumeStateInput
): ConsumeStateResult {
  const now = input.now ?? new Date();
  if (!record || record.state !== input.state) {
    return { ok: false, reason: "STATE_MISMATCH" };
  }
  if (record.organizationId !== input.organizationId) {
    return { ok: false, reason: "TENANT_MISMATCH" };
  }
  if (record.consumedAt) {
    return { ok: false, reason: "ALREADY_USED" };
  }
  if (new Date(record.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "EXPIRED" };
  }
  return { ok: true, record };
}
