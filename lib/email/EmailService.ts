import type { EmailAccount } from '@prisma/client';
import { GmailAdapter } from './adapters/GmailAdapter';
import { OutlookAdapter } from './adapters/OutlookAdapter';
import { ImapAdapter } from './adapters/ImapAdapter';
import { decrypt } from '@/lib/crypto';
import { toInboxBatch, type InboxBatch } from './inboxBatch';

export interface SendEmailOptions {
  from: string;
  /** Display name for the From header; see `lib/email/senderName.ts`. */
  fromName?: string | null;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
    /** Content id for an inline image (`<img src="cid:…">`); nodemailer embeds it in the MIME. */
    cid?: string;
  }>;
  /** Present when this message is a reply in an existing conversation (lib/sequences/threading.ts). */
  threading?: SendThreading;
}

/** What makes a message land in an existing thread instead of starting one. */
export interface SendThreading {
  /** RFC Message-ID of the message being replied to, angle brackets included. */
  inReplyTo: string;
  /** The parent's References chain followed by its Message-ID, space separated. */
  references: string;
  /** Gmail conversation id; Gmail threads the sender's copy only when this is given. */
  threadId?: string;
}

/** What a provider reported about a send. Every field is the provider's word, or absent. */
export interface SendReceipt {
  providerMessageId?: string;
  rfcMessageId?: string;
  providerThreadId?: string;
}

/** An adapter reports its bare provider id, nothing, or a full receipt. */
export type SendResult = string | undefined | SendReceipt;

/** A message fetched from a connected inbox (metadata only — no body). */
export interface InboxMessage {
  /** Provider's unique message ID (Gmail msg.id, Graph message.id, IMAP UID). */
  providerMessageId: string;
  fromEmail: string;
  fromName?: string | null;
  to?: string;
  subject: string;
  date: Date;
  body?: string | null;
  bodyHtml?: string | null;
  /** Recipient extracted from an NDR header (X-Failed-Recipients), if present. */
  failedRecipient?: string | null;
  isSpam?: boolean;
  isTrash?: boolean;
  /**
   * When the provider received it (Gmail `internalDate`, Graph `receivedDateTime`). The sync cursor
   * moves by this, never by `date`, which is the sender's own `Date:` header and can be anything.
   */
  receivedAt?: Date;
}


export interface EmailAdapter {
  /** Send an email. Returns what the provider reported: its message id, or a full receipt. */
  send(options: SendEmailOptions): Promise<SendResult>;
  /** Fetch inbox messages received since `since`. Optional — not all adapters sync. */
  fetchMessagesSince?(since: Date): Promise<InboxMessage[] | InboxBatch>;
}

/**
 * Provider-agnostic email abstraction.
 * Call EmailService.fromAccount(account) to get the right adapter.
 */
export class EmailService {
  private adapter: EmailAdapter;

  constructor(adapter: EmailAdapter) {
    this.adapter = adapter;
  }

  async send(options: SendEmailOptions): Promise<SendResult> {
    return this.adapter.send(options);
  }

  /** Returns null when the underlying adapter does not support inbox sync. */
  async fetchMessagesSince(since: Date): Promise<InboxBatch | null> {
    if (!this.adapter.fetchMessagesSince) return null;
    return toInboxBatch(await this.adapter.fetchMessagesSince(since));
  }

  static async fromAccount(account: EmailAccount): Promise<EmailService> {
    switch (account.provider) {
      case 'gmail': {
        const accessToken = account.encAccessToken
          ? await decrypt(account.encAccessToken)
          : account.accessToken;
        const refreshToken = account.encRefreshToken
          ? await decrypt(account.encRefreshToken)
          : account.refreshToken;
        return new EmailService(
          new GmailAdapter({
            accessToken: accessToken!,
            refreshToken: refreshToken!,
            tokenExpiry: account.tokenExpiry ?? undefined,
            accountId: account.id,
          })
        );
      }

      case 'outlook': {
        const accessToken = account.encAccessToken
          ? await decrypt(account.encAccessToken)
          : account.accessToken;
        const refreshToken = account.encRefreshToken
          ? await decrypt(account.encRefreshToken)
          : account.refreshToken;
        return new EmailService(
          new OutlookAdapter({
            accessToken: accessToken!,
            refreshToken: refreshToken!,
            tokenExpiry: account.tokenExpiry ?? undefined,
            accountId: account.id,
          })
        );
      }

      case 'imap_smtp':
        return new EmailService(
          new ImapAdapter({
            email: account.email,
            password: await decrypt(account.encPassword!),
            smtpServer: account.smtpServer!,
            smtpPort: account.smtpPort ?? 465,
            imapServer: account.imapServer ?? undefined,
            imapPort: account.imapPort ?? undefined,
          })
        );

      default:
        throw new Error(`Unknown email provider: ${account.provider}`);
    }
  }
}
