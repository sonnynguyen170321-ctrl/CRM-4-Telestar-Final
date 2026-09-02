import "server-only";

import type { SenderTransportRow } from "../credentials/credentialLoader";
import { verifySmtpConnection } from "../providers/smtpTransport";

// S6: verify a sender's SMTP (and IMAP, if configured) credentials before it is
// activated / flipped live. Decrypted secrets live only in memory inside the
// provider verify calls; this orchestrator NEVER returns or logs the raw
// provider error — it maps failures to a FIXED category string so a credential
// can never leak into a read model or log (Invariant 9).

export type SenderVerifyCheck = {
  ok: boolean;
  error?: SenderVerifyError;
};

export type SenderVerifyError =
  | "AUTH_FAILED"
  | "CONNECTION_FAILED"
  | "TLS_ERROR"
  | "TIMEOUT"
  | "VERIFY_FAILED";

export type SenderVerifyResult = {
  smtp: SenderVerifyCheck;
  imap: SenderVerifyCheck | null; // null = no IMAP configured
  ok: boolean;
};

export type VerifySenderInput = SenderTransportRow & {
  imapHost?: string | null;
  imapAuthEnc?: unknown;
};

export type VerifySenderDeps = {
  verifySmtp?: (sender: VerifySenderInput, env: NodeJS.ProcessEnv) => Promise<void>;
  verifyImap?: (sender: VerifySenderInput, env: NodeJS.ProcessEnv) => Promise<void>;
  env?: NodeJS.ProcessEnv;
};

export async function verifySenderConnection(
  sender: VerifySenderInput,
  deps: VerifySenderDeps = {}
): Promise<SenderVerifyResult> {
  const env = deps.env ?? process.env;
  const verifySmtp = deps.verifySmtp ?? verifySmtpConnection;

  const smtp = await runCheck(() => verifySmtp(sender, env));

  let imap: SenderVerifyCheck | null = null;
  if (sender.imapHost && sender.imapAuthEnc) {
    const verifyImap = deps.verifyImap ?? defaultVerifyImap;
    imap = await runCheck(() => verifyImap(sender, env));
  }

  return { smtp, imap, ok: smtp.ok && (imap === null || imap.ok) };
}

async function runCheck(fn: () => Promise<void>): Promise<SenderVerifyCheck> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

/**
 * Map a provider error to a fixed category. We deliberately do NOT pass through
 * the raw provider message, which can echo the submitted credentials.
 */
export function classifyError(error: unknown): SenderVerifyError {
  const raw = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ""}` : String(error);
  const text = raw.toLowerCase();

  if (
    /eauth|invalid login|login failed|535|534|authentication|authenticationfailed|auth failed|username and password|invalid credentials/.test(
      text
    )
  ) {
    return "AUTH_FAILED";
  }
  if (/timed out|timeout|etimedout|greeting never received/.test(text)) {
    return "TIMEOUT";
  }
  if (/cert|tls|ssl|self.signed|wrong version number/.test(text)) {
    return "TLS_ERROR";
  }
  if (/econn|enotfound|ehostunreach|enetunreach|connect|getaddrinfo|socket/.test(text)) {
    return "CONNECTION_FAILED";
  }
  return "VERIFY_FAILED";
}

// imapflow is imported lazily so test injection (and the SMTP-only path) never
// loads it. Decrypted creds stay in memory; errors are classified by the caller.
async function defaultVerifyImap(
  sender: VerifySenderInput,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const { loadImapConnectionConfig } = await import("../credentials/credentialLoader");
  const config = loadImapConnectionConfig(sender, env);
  if (!config) {
    return;
  }
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
    logger: false,
    socketTimeout: 10_000,
  });
  try {
    await client.connect();
  } finally {
    await client.logout().catch(() => {});
  }
}

export const SENDER_VERIFY_ERROR_LABELS: Record<SenderVerifyError, string> = {
  AUTH_FAILED: "Authentication failed — check username / app password.",
  CONNECTION_FAILED: "Could not reach the mail server — check host and port.",
  TLS_ERROR: "TLS/SSL handshake failed — check the secure/port setting.",
  TIMEOUT: "The server did not respond in time.",
  VERIFY_FAILED: "Connection verification failed.",
};
