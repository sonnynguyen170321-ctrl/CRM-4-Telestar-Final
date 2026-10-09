import type { EmailAdapter, InboxMessage, SendEmailOptions } from '../EmailService';
import { SYNC_READ_LIMIT, type InboxBatch } from '../inboxBatch';
import { fromHeaderValue } from '@/lib/email/senderName';
import { encrypt } from '@/lib/crypto';
import DOMPurify from 'isomorphic-dompurify';

interface OutlookConfig {
  accessToken: string;
  refreshToken: string;
  tokenExpiry?: Date;
  /** EmailAccount.id — used to persist refreshed tokens back to the DB. */
  accountId?: string;
}

const GRAPH_SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';
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

  async send(options: SendEmailOptions): Promise<string | undefined> {
    let token = this.config.accessToken;

    const MailComposer = (await import('nodemailer/lib/mail-composer')).default;
    const mail = new MailComposer({
      from: fromHeaderValue(options.from, options.fromName),
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
      attachments: options.attachments,
      // The recipient's client threads on these. Graph reports no Message-ID for a send, so a
      // step after this one has nothing to reply to and goes out as a new email.
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

    let res = await sendRequest(token);

    // Token expired — refresh and retry once
    if (res.status === 401) {
      token = await this.refreshAccessToken();
      res = await sendRequest(token);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Microsoft Graph API error: ${err.error?.message ?? res.statusText}`);
    }
    // Graph sendMail returns 202 Accepted with no body — no message ID available for reconciliation.
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
      '&$select=from,toRecipients,subject,receivedDateTime,body&$orderby=receivedDateTime asc&$top=100';

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
    isSpam: false,
    isTrash: false,
    receivedAt,
  };
}
