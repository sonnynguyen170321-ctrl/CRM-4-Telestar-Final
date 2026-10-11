import type { EmailAdapter, InboxMessage, SendEmailOptions, SendReceipt } from '../EmailService';
import { SYNC_READ_LIMIT, type InboxBatch } from '../inboxBatch';
import { fromHeaderValue } from '@/lib/email/senderName';
import { encrypt } from '@/lib/crypto';
import DOMPurify from 'isomorphic-dompurify';
import { randomUUID } from 'node:crypto';

interface OutlookConfig {
  accessToken: string;
  refreshToken: string;
  tokenExpiry?: Date;
  /** EmailAccount.id — used to persist refreshed tokens back to the DB. */
  accountId?: string;
  /** Waits before each Sent Items lookup after a send. Tests pass `[0]`. */
  sentLookupDelaysMs?: number[];
}

const GRAPH_SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';
const GRAPH_SENT_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages';
/** Waits before each look into Sent Items: the sent copy appears a moment after the 202. */
const SENT_LOOKUP_DELAYS_MS = [1_500, 3_500];
/** The sent time Exchange records can sit slightly behind our clock. */
const SENT_CLOCK_SKEW_MS = 60_000;
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/**
 * Outlook/Exchange adapter using the Microsoft Graph API.
 * Requires MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in env.
 */
export class OutlookAdapter implements EmailAdapter {
  private config: OutlookConfig;

  constructor(config: OutlookConfig) {
    this.config = config;
  }

  private async refreshAccessToken(): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access',
      }),
    });

    if (!res.ok) {
      throw new Error(`Microsoft token refresh failed: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.access_token) {
      throw new Error(`Microsoft token refresh returned no access_token: ${data.error_description ?? data.error}`);
    }
    this.config.accessToken = data.access_token;
    if (data.refresh_token) {
      this.config.refreshToken = data.refresh_token;
    }
    if (this.config.accountId) {
      const { prisma } = await import('@/lib/prisma');
      const [encAccessToken, encRefreshToken] = await Promise.all([
        encrypt(data.access_token),
        data.refresh_token ? encrypt(data.refresh_token) : Promise.resolve(undefined),
      ]);
      await prisma.emailAccount.update({
        where: { id: this.config.accountId },
        data: {
          accessToken: null,
          encAccessToken,
          refreshToken: data.refresh_token ? null : undefined,
          encRefreshToken,
          tokenExpiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
        },
      });
    }
    return data.access_token;
  }

  /**
   * Send, then learn the RFC Message-ID Exchange gave the message.
   *
   * `sendMail` answers 202 with no body, so a later sequence step or inbox reply had no Message-ID
   * to put in In-Reply-To and went out as a new email. The draft route (create, read
   * `internetMessageId`, send) needs the Mail.ReadWrite scope, which connected mailboxes were never
   * asked for, so this keeps `sendMail` and reads the result back from Sent Items with Mail.Read,
   * which they have:
   *
   *   1. our own Message-ID goes in the MIME, and Sent Items is searched for it
   *   2. if Exchange rewrote it, the sent copy is matched on recipient, subject and send time
   *
   * Only an id Graph reports is returned, never our guess. The message is sent either way: a
   * failed lookup costs the next step its thread (it goes out as a new email), never the send.
   */
  async send(options: SendEmailOptions): Promise<SendReceipt> {
    const MailComposer = (await import('nodemailer/lib/mail-composer')).default;
    const domain = options.from.split('@')[1] || 'localhost';
    const ownMessageId = `<${randomUUID()}@${domain}>`;
    const startedAt = new Date(Date.now() - SENT_CLOCK_SKEW_MS);
    const mail = new MailComposer({
      from: fromHeaderValue(options.from, options.fromName),
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
      attachments: options.attachments,
      messageId: ownMessageId,
      // The recipient's client threads on these.
      inReplyTo: options.threading?.inReplyTo,
      references: options.threading?.references,
    });

    // Graph's sendMail takes MIME only base64-encoded (text/plain body); raw MIME is refused as
    // invalid base64. https://learn.microsoft.com/graph/api/user-sendmail#request-body
    const rawMessageBuffer = await mail.compile().build();
    const rawMime = rawMessageBuffer.toString('base64');

    const sendRequest = async (accessToken: string) => {
      return fetch(GRAPH_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain',
        },
        body: rawMime,
      });
    };

    let res = await sendRequest(this.config.accessToken);

    // Token expired — refresh and retry once
    if (res.status === 401) {
      const token = await this.refreshAccessToken();
      res = await sendRequest(token);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Microsoft Graph API error: ${err.error?.message ?? res.statusText}`);
    }

    try {
      const rfcMessageId = await this.findSentMessageId({
        ownMessageId,
        to: options.to,
        subject: options.subject,
        since: startedAt,
      });
      return rfcMessageId ? { providerMessageId: rfcMessageId, rfcMessageId } : {};
    } catch (err) {
      console.warn('[outlook] sent, but could not read back the Message-ID:', err instanceof Error ? err.message : err);
      return {};
    }
  }

  /** One GET against Graph with the current token, refreshed once on 401. */
  private async graphGet(url: string): Promise<Response> {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${this.config.accessToken}` } });
    if (res.status === 401) {
      const token = await this.refreshAccessToken();
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    return res;
  }

  /** The Message-ID of the copy of this message in Sent Items, or undefined when it cannot be found. */
  private async findSentMessageId(input: {
    ownMessageId: string;
    to: string;
    subject: string;
    since: Date;
  }): Promise<string | undefined> {
    const delays = this.config.sentLookupDelaysMs ?? SENT_LOOKUP_DELAYS_MS;
    const odataString = (value: string) => value.replace(/'/g, "''");
    const byOwnId =
      `${GRAPH_SENT_URL}?$filter=internetMessageId eq '${odataString(input.ownMessageId)}'` +
      '&$select=internetMessageId&$top=1';
    const recent =
      `${GRAPH_SENT_URL}?$filter=sentDateTime ge ${input.since.toISOString()}` +
      '&$select=internetMessageId,subject,toRecipients,sentDateTime&$orderby=sentDateTime desc&$top=25';

    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

      const own = await this.graphGet(byOwnId);
      if (own.ok) {
        const found = ((await own.json()) as { value?: Array<{ internetMessageId?: string }> }).value?.[0];
        if (found?.internetMessageId) return found.internetMessageId;
      }

      const list = await this.graphGet(recent);
      if (list.ok) {
        const items = ((await list.json()) as { value?: any[] }).value ?? [];
        const wanted = input.to.trim().toLowerCase();
        const match = items.find(
          (m) =>
            m?.internetMessageId &&
            m.subject === input.subject &&
            (m.toRecipients ?? []).some(
              (r: any) => String(r?.emailAddress?.address ?? '').toLowerCase() === wanted
            )
        );
        if (match) return match.internetMessageId as string;
      }
    }
    return undefined;
  }

  /**
   * Fetch inbox messages received since `since` (metadata only).
   * Requires the Mail.Read scope — accounts connected before that scope was
   * added must be reconnected from Settings.
   */
  async fetchMessagesSince(since: Date): Promise<InboxBatch> {
    // Oldest first, page by page, until the run's limit: a run that stops leaves only newer mail,
    // and the sync moves its cursor to the last message read. It used to take the newest 50 and
    // nothing else, so a burst of bounces after a batch send was mostly never read.
    let next: string | null =
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages' +
      `?$filter=receivedDateTime ge ${since.toISOString()}` +
      '&$select=from,toRecipients,subject,receivedDateTime,body,internetMessageId,internetMessageHeaders&$orderby=receivedDateTime asc&$top=100';

    let token = this.config.accessToken;
    const messages: InboxMessage[] = [];
    while (next && messages.length < SYNC_READ_LIMIT) {
      let res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        token = await this.refreshAccessToken();
        res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Microsoft Graph inbox fetch failed: ${(err as any).error?.message ?? res.statusText}`);
      }
      const data: { value?: unknown[]; '@odata.nextLink'?: unknown } = await res.json();
      for (const m of (data.value ?? []) as any[]) {
        if (messages.length >= SYNC_READ_LIMIT) break;
        messages.push(toInboxMessage(m));
      }
      next = typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null;
    }
    return { messages, truncated: Boolean(next) || messages.length >= SYNC_READ_LIMIT };
  }
}

/** Build the Microsoft OAuth authorization URL. */
export function getMicrosoftAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
    scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access',
    response_mode: 'query',
    ...(state ? { state } : {}),
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

/** Exchange an authorization code for Microsoft tokens. */
export async function exchangeMicrosoftCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    throw new Error(`Microsoft token exchange failed: ${res.statusText}`);
  }

  const tokens = await res.json();
  if (!tokens.access_token) {
    throw new Error(`Microsoft token exchange returned no access_token: ${tokens.error_description ?? tokens.error}`);
  }

  // Get the user's email via Graph
  const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Microsoft Graph profile fetch failed: ${profileRes.statusText}`);
  }
  const profile = await profileRes.json();

  return {
    email: (profile.mail ?? profile.userPrincipalName) as string,
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    tokenExpiry: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null,
  };
}

/**
 * The text of an HTML body, read by the parser. A tag-stripping regex can leave markup behind (a
 * `<scr<script>ipt>` shape survives one pass), and this text is shown in the inbox.
 */
function htmlToText(html: string): string {
  const fragment = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], KEEP_CONTENT: true, RETURN_DOM_FRAGMENT: true });
  return (fragment.textContent ?? '').trim();
}

function internetHeader(headers: unknown, name: string): string | null {
  if (!Array.isArray(headers)) return null;
  const hit = headers.find((h: any) => String(h?.name ?? '').toLowerCase() === name.toLowerCase());
  return hit?.value ? String(hit.value) : null;
}

function toInboxMessage(m: any): InboxMessage {
  const fromEmail = (m.from?.emailAddress?.address ?? '').toLowerCase();
  const fromName = m.from?.emailAddress?.name ?? null;
  const to = (m.toRecipients?.[0]?.emailAddress?.address ?? '').toLowerCase();
  const isHtml = m.body?.contentType === 'html';
  const rawBody = m.body?.content ?? '';
  const receivedAt = new Date(m.receivedDateTime);
  return {
    providerMessageId: m.id,
    fromEmail,
    fromName,
    to,
    subject: m.subject ?? '',
    date: receivedAt,
    body: isHtml ? htmlToText(rawBody) : rawBody,
    bodyHtml: isHtml ? rawBody : rawBody,
    failedRecipient: null,
    rfcMessageId: m.internetMessageId || null,
    referencesHeader: internetHeader(m.internetMessageHeaders, 'References'),
    isSpam: false,
    isTrash: false,
    receivedAt,
  };
}
