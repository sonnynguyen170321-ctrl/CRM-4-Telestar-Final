import { decryptSecret, encryptSecret, isSecretEnvelope, loadMasterKey, type SecretEnvelope } from "./encryption";

// O3 / design B1: load + decrypt a sender's credentials at use, for the SMTP
// adapter (O-LIVE) and IMAP poller. The auth envelope encrypts a {user, pass}
// JSON so both are protected. Decrypted secrets live only in memory for the call
// and are NEVER logged or returned by any read model. Fail-closed when the master
// key is absent. Pure (the key comes from env; the envelope from the sender row).

export type SenderAuth = { user: string; pass: string };

/** Encrypt a sender's {user, pass} into a storable envelope (used when adding a sender). */
export function encryptSenderAuth(auth: SenderAuth, env: NodeJS.ProcessEnv = process.env): SecretEnvelope {
  const key = loadMasterKey(env); // throws (fail closed) if unset
  return encryptSecret(JSON.stringify(auth), key);
}

/** Decrypt a sender auth envelope back to {user, pass}. Throws on missing key / tamper. */
export function decryptSenderAuth(envelope: unknown, env: NodeJS.ProcessEnv = process.env): SenderAuth {
  if (!isSecretEnvelope(envelope)) {
    throw new Error("Sender auth is not a valid encrypted envelope.");
  }
  const key = loadMasterKey(env);
  const json = decryptSecret(envelope, key);
  const parsed = JSON.parse(json) as SenderAuth;
  if (!parsed || typeof parsed.user !== "string" || typeof parsed.pass !== "string") {
    throw new Error("Decrypted sender auth has an unexpected shape.");
  }
  return parsed;
}

export type SenderTransportRow = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpAuthEnc: unknown;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean | null;
  imapAuthEnc?: unknown;
};

export type SmtpConnectionConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: SenderAuth;
};

export type ImapConnectionConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: SenderAuth;
};

/** Build the SMTP connection config (decrypting creds) for the O-LIVE transport. */
export function loadSmtpConnectionConfig(
  sender: SenderTransportRow,
  env: NodeJS.ProcessEnv = process.env
): SmtpConnectionConfig {
  return {
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    auth: decryptSenderAuth(sender.smtpAuthEnc, env),
  };
}

/** Build the IMAP connection config (decrypting creds) for the O5s poller, or null. */
export function loadImapConnectionConfig(
  sender: SenderTransportRow,
  env: NodeJS.ProcessEnv = process.env
): ImapConnectionConfig | null {
  if (!sender.imapHost || sender.imapPort == null || !sender.imapAuthEnc) {
    return null;
  }
  return {
    host: sender.imapHost,
    port: sender.imapPort,
    secure: sender.imapSecure ?? true,
    auth: decryptSenderAuth(sender.imapAuthEnc, env),
  };
}
