import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// O3 / design B1: app-layer envelope encryption for sender credentials.
// AES-256-GCM with a per-secret random 12-byte IV; master key from env
// V2_OUTREACH_CREDENTIAL_KEY (32-byte base64). Secrets are NEVER stored or logged
// in plaintext; the loader fails closed when the key is absent. Pure crypto.

export type SecretEnvelope = {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  keyVersion: number;
};

const KEY_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Load + validate the 32-byte master key from env. Throws (fail closed) if absent/invalid. */
export function loadMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = (env.V2_OUTREACH_CREDENTIAL_KEY ?? "").trim();
  if (!raw) {
    throw new Error("V2_OUTREACH_CREDENTIAL_KEY is not set — credential encryption is unavailable (fail closed).");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`V2_OUTREACH_CREDENTIAL_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}).`);
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): SecretEnvelope {
  if (key.length !== KEY_BYTES) {
    throw new Error("encryptSecret: key must be 32 bytes.");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptSecret(envelope: SecretEnvelope, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error("decryptSecret: key must be 32 bytes.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(), // throws on tamper (auth tag mismatch)
  ]);
  return plaintext.toString("utf8");
}

export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SecretEnvelope).ciphertext === "string" &&
    typeof (value as SecretEnvelope).iv === "string" &&
    typeof (value as SecretEnvelope).authTag === "string"
  );
}

/** Generate a fresh 32-byte master key as base64 (for ops to set V2_OUTREACH_CREDENTIAL_KEY). */
export function generateMasterKeyBase64(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
