import nodemailer from 'nodemailer';
import { fromHeaderValue } from '@/lib/email/senderName';
import { ImapFlow } from 'imapflow';
import type { EmailAdapter, InboxMessage, SendEmailOptions, SendResult } from '../EmailService';
import { SYNC_READ_LIMIT, type InboxBatch } from '../inboxBatch';

interface ImapConfig {
  email: string;
  password: string;
  smtpServer: string;
  smtpPort: number;
  imapServer?: string;
  imapPort?: number;
}

/**
 * IMAP/SMTP adapter for Roundcube and any standard mail server.
 * Uses nodemailer for sending (SMTP) and imapflow for reading (IMAP).
 */
export class ImapAdapter implements EmailAdapter {
  private config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  async send(options: SendEmailOptions): Promise<SendResult> {
    const transporter = nodemailer.createTransport({
      host: this.config.smtpServer,
      port: this.config.smtpPort,
      secure: this.config.smtpPort === 465,
      auth: {
        user: this.config.email,
        pass: this.config.password,
      },
      tls: { rejectUnauthorized: process.env.MAIL_ALLOW_SELF_SIGNED !== 'true' },
    });

    const info = await transporter.sendMail({
      from: fromHeaderValue(options.from, options.fromName),
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
      attachments: options.attachments,
      inReplyTo: options.threading?.inReplyTo,
      references: options.threading?.references,
    });
    // An SMTP server keeps the Message-ID it was handed, so the id nodemailer reports is the one
    // the prospect's mail client sees.
    return { providerMessageId: info.messageId, rfcMessageId: info.messageId };
  }

  /** Fetch inbox messages received since `since` via IMAP. */
  async fetchMessagesSince(since: Date): Promise<InboxBatch> {
    if (!this.config.imapServer) return { messages: [], truncated: false };

    const client = new ImapFlow({
      host: this.config.imapServer,
      port: this.config.imapPort ?? 993,
      secure: (this.config.imapPort ?? 993) === 993,
      auth: { user: this.config.email, pass: this.config.password },
      socketTimeout: 30_000,
      logger: false,
      tls: { rejectUnauthorized: process.env.MAIL_ALLOW_SELF_SIGNED !== 'true' },
    });

    const { simpleParser } = await import('mailparser');

    await client.connect();
    const messages: InboxMessage[] = [];
    let truncated = false;
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // A UID is unique in one mailbox only (and only while UIDVALIDITY holds), but the stored id is
        // unique across every mailbox: two mailboxes' UID 123 collided, and the second one's message
        // — a bounce, a reply — was taken for already stored and never read.
        const uidValidity = String((client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.uidValidity : '') ?? '');
        const idFor = (uid: number) => `imap:${this.config.email.toLowerCase()}:${uidValidity}:${uid}`;
        // IMAP SEARCH SINCE compares dates only, so it returns the whole day; the server's own receipt
        // time (INTERNALDATE) says which of those are past the cursor. Oldest first, up to the run's
        // limit — it used to keep only the newest 30, and anything older in that run was never read.
        const uids = ((await client.search({ since }, { uid: true })) || []) as number[];
        const pending: { uid: number; receivedAt: Date }[] = [];
        if (uids.length > 0) {
          for await (const msg of client.fetch(uids, { uid: true, internalDate: true }, { uid: true })) {
            const receivedAt = msg.internalDate ? new Date(msg.internalDate) : null;
            if (receivedAt && receivedAt.getTime() >= since.getTime()) pending.push({ uid: msg.uid, receivedAt });
          }
        }
        pending.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.uid - b.uid);
        const toRead = pending.slice(0, SYNC_READ_LIMIT);
        truncated = toRead.length < pending.length;
        const receivedByUid = new Map(toRead.map((m) => [m.uid, m.receivedAt]));
        if (toRead.length > 0) {
          for await (const msg of client.fetch(toRead.map((m) => m.uid), { uid: true, envelope: true, source: true }, { uid: true })) {
            const parsed = (await (simpleParser as any)(msg.source || '')) as any;
            const from = msg.envelope?.from?.[0];
            const to = msg.envelope?.to?.[0];
            messages.push({
              providerMessageId: idFor(msg.uid),
              legacyProviderMessageId: String(msg.uid),
              fromEmail: (from?.address ?? '').toLowerCase(),
              fromName: from?.name ?? null,
              to: (to?.address ?? '').toLowerCase(),
              subject: msg.envelope?.subject ?? '',
              date: msg.envelope?.date ?? new Date(),
              body: parsed.text || '',
              bodyHtml: parsed.html || parsed.text || '',
              failedRecipient: null,
              isSpam: false,
              isTrash: false,
              receivedAt: receivedByUid.get(msg.uid),
            });
          }
          messages.sort((a, b) => (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0));
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
    return { messages, truncated };
  }

  /** Verify the SMTP connection credentials. Returns true if valid. */
  async verify(): Promise<boolean> {
    try {
      const transporter = nodemailer.createTransport({
        host: this.config.smtpServer,
        port: this.config.smtpPort,
        secure: this.config.smtpPort === 465,
        auth: { user: this.config.email, pass: this.config.password },
        tls: { rejectUnauthorized: process.env.MAIL_ALLOW_SELF_SIGNED !== 'true' },
      });
      await transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

/** Verify IMAP/SMTP credentials before saving to DB. */
export async function verifyImapCredentials(config: ImapConfig): Promise<boolean> {
  const adapter = new ImapAdapter(config);
  return adapter.verify();
}
