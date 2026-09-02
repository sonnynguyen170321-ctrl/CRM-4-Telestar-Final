import {
  assertNotSuppressed,
  isGatePassToken,
  type GatePassToken,
  type LoadSuppressionCandidates,
} from "../suppression/index";

// O3: the send boundary. A ProviderInterface.send REQUIRES a GatePassToken (only
// mintable by the O2 gate, design B5), and the executor is the only thing that
// mints one — so no code path can reach a provider without passing suppression.
// Ships a sandbox provider (no network) and an SMTP adapter that is INERT until
// O9 (liveSendEnabled). Secrets are never logged.

export type ProviderSendRequest = {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string; // plaintext part (always present — the deliverability/fallback body)
  html?: string; // optional HTML part; when set the message is sent multipart text+html
  attachments?: OutboundAttachment[];
  // High-entropy Message-ID minted by the caller at the SENDING transition (B2/B3).
  messageId: string;
  inReplyTo?: string;
  // Extra headers, e.g. List-Unsubscribe (B4).
  headers?: Record<string, string>;
};

export type OutboundAttachment = { filename: string; mimeType: string; content: Buffer };

export type ProviderSendResult = {
  providerMessageId: string;
  accepted: boolean;
  smtpResponse?: string;
  error?: string;
};

export interface ProviderInterface {
  readonly name: string;
  send(request: ProviderSendRequest, token: GatePassToken): Promise<ProviderSendResult>;
}

function requireToken(token: unknown): asserts token is GatePassToken {
  if (!isGatePassToken(token)) {
    throw new Error("Provider.send requires a GatePassToken from the suppression gate (Invariant 10 / B5).");
  }
}

/** Sandbox provider: records sends in-memory, never touches the network. */
export class SandboxProvider implements ProviderInterface {
  readonly name = "sandbox";
  readonly sent: ProviderSendRequest[] = [];

  async send(request: ProviderSendRequest, token: GatePassToken): Promise<ProviderSendResult> {
    requireToken(token);
    this.sent.push(request);
    return { providerMessageId: request.messageId, accepted: true, smtpResponse: "250 sandbox accepted" };
  }
}

export type SmtpTransport = {
  // nodemailer-style; injected only at O9 cutover so there is no hard dependency here.
  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: { filename: string; content: Buffer; contentType: string }[];
    messageId: string;
    inReplyTo?: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string; response?: string }>;
};

export type SmtpAdapterConfig = {
  liveSendEnabled: boolean;
  // Provided at O9 (decrypted creds → a real transport). Absent ⇒ inert.
  transportFactory?: () => Promise<SmtpTransport> | SmtpTransport;
};

/** SMTP adapter. INERT until O9: refuses to send unless liveSendEnabled + a transport. */
export class SmtpAdapter implements ProviderInterface {
  readonly name = "smtp";
  private readonly config: SmtpAdapterConfig;

  constructor(config: SmtpAdapterConfig) {
    this.config = config;
  }

  async send(request: ProviderSendRequest, token: GatePassToken): Promise<ProviderSendResult> {
    requireToken(token);
    if (!this.config.liveSendEnabled || !this.config.transportFactory) {
      throw new Error("SMTP live send is disabled (enabled at O9 cutover only).");
    }
    const transport = await this.config.transportFactory();
    try {
      const result = await transport.sendMail({
        from: request.fromName ? `${request.fromName} <${request.from}>` : request.from,
        to: request.to,
        subject: request.subject,
        text: request.body,
        html: request.html,
        attachments: request.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.mimeType })),
        messageId: request.messageId,
        inReplyTo: request.inReplyTo,
        headers: request.headers,
      });
      return {
        providerMessageId: result.messageId ?? request.messageId,
        accepted: true,
        smtpResponse: result.response,
      };
    } catch (error) {
      // Synchronous SMTP failure (e.g. 5xx) — recorded as a non-accept; never log creds.
      return {
        providerMessageId: request.messageId,
        accepted: false,
        error: error instanceof Error ? error.message : "smtp send failed",
      };
    }
  }
}

export type ExecuteSendInput = {
  provider: ProviderInterface;
  request: ProviderSendRequest;
  organizationId: string;
  loadCandidates?: LoadSuppressionCandidates;
  now?: Date;
};

/**
 * The ONLY path to a provider (design B5): pass the suppression gate, then send.
 * Throws SuppressedError before any provider call when the recipient is suppressed.
 */
export async function executeSend(input: ExecuteSendInput): Promise<ProviderSendResult> {
  const token = await assertNotSuppressed({
    organizationId: input.organizationId,
    email: input.request.to,
    loadCandidates: input.loadCandidates,
    now: input.now,
  });
  return input.provider.send(input.request, token);
}
