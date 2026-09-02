import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { SmtpAdapter, type SmtpTransport } from "./index";
import {
  loadSmtpConnectionConfig,
  type SenderTransportRow,
} from "../credentials/credentialLoader";

// OL1: the real SMTP transport behind SmtpAdapter.transportFactory. Builds a
// pooled nodemailer transport from a sender's DECRYPTED credentials (B1) at use.
// Secrets live only in memory for the connection and are NEVER logged. This
// module is the only place nodemailer is imported, so the adapter stays
// dependency-free and inert until a live sender is resolved.

// Per-process connection pool keyed by host:port:user so repeated sends reuse the
// SMTP connection (throughput) without re-decrypting on every message.
const transportPool = new Map<string, Transporter>();
const SMTP_SEND_TIMEOUT_MS = 20_000;
const SMTP_VERIFY_TIMEOUT_MS = 10_000;

export function buildSmtpTransport(
  sender: SenderTransportRow,
  env: NodeJS.ProcessEnv = process.env
): SmtpTransport {
  const config = loadSmtpConnectionConfig(sender, env); // decrypts {user, pass}
  const key = `${config.host}:${config.port}:${config.auth.user}`;

  let transporter = transportPool.get(key);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      name: smtpClientName(env),
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.auth.user, pass: config.auth.pass },
      requireTLS: !config.secure,
      tls: { servername: config.host },
      connectionTimeout: SMTP_SEND_TIMEOUT_MS,
      greetingTimeout: SMTP_SEND_TIMEOUT_MS,
      socketTimeout: SMTP_SEND_TIMEOUT_MS,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
    transportPool.set(key, transporter);
  }
  const active = transporter;

  return {
    async sendMail(input) {
      const info = await active.sendMail({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
        // Use OUR high-entropy Message-ID (B2/B3), not nodemailer's default.
        messageId: input.messageId,
        inReplyTo: input.inReplyTo,
        headers: input.headers,
      });
      return { messageId: info.messageId, response: info.response };
    },
  };
}

/**
 * S6: verify a sender's SMTP credentials by opening a real connection and
 * authenticating (nodemailer `verify()` = greeting + STARTTLS/secure + AUTH),
 * then closing. Throws on any failure. Decrypted creds live only in memory and
 * are never logged. Uses a fresh (non-pooled) transport with bounded timeouts so
 * a bad host cannot hang the verification action.
 */
export async function verifySmtpConnection(
  sender: SenderTransportRow,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const config = loadSmtpConnectionConfig(sender, env);
  const transporter = nodemailer.createTransport({
    name: smtpClientName(env),
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
    requireTLS: !config.secure,
    tls: { servername: config.host },
    connectionTimeout: SMTP_VERIFY_TIMEOUT_MS,
    greetingTimeout: SMTP_VERIFY_TIMEOUT_MS,
    socketTimeout: SMTP_VERIFY_TIMEOUT_MS,
  });
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
}

/** transportFactory hook for SmtpAdapter, bound to one sender. */
export function createSenderTransportFactory(
  sender: SenderTransportRow,
  env: NodeJS.ProcessEnv = process.env
): () => SmtpTransport {
  return () => buildSmtpTransport(sender, env);
}

/**
 * Build a gated SmtpAdapter for a sender. It only sends live when the sender's
 * liveSendEnabled flag is true (the O9/OL7 cutover gate); otherwise the adapter
 * refuses. Credential decryption is deferred to the first send (transportFactory).
 */
function smtpClientName(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? env.APP_BASE_URL;
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname;
  } catch {
    return undefined;
  }
}

export function createSenderSmtpAdapter(
  sender: SenderTransportRow & { liveSendEnabled: boolean },
  env: NodeJS.ProcessEnv = process.env
): SmtpAdapter {
  return new SmtpAdapter({
    liveSendEnabled: sender.liveSendEnabled,
    transportFactory: createSenderTransportFactory(sender, env),
  });
}
