import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Owner, 2026-10-09: a bounced address was sent the follow-up. The inbox sync read the newest 50
 * messages per run and moved its cursor to "now", so whatever lay beyond those 50 — a burst of bounces
 * right after a batch send — was never read, and never suppressed.
 *
 * Now each run pages through everything since the cursor, reads the oldest first up to a limit, and
 * when it stops at the limit the cursor moves only as far as what it read.
 */

const gmailList = vi.fn();
const gmailGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        on() {}
      },
    },
    gmail: () => ({ users: { messages: { list: (...a: unknown[]) => gmailList(...a), get: (...a: unknown[]) => gmailGet(...a) } } }),
  },
}));
vi.mock('@/lib/crypto', () => ({ encrypt: async (v: string) => v, decrypt: async (v: string) => v }));

const { GmailAdapter } = await import('@/lib/email/adapters/GmailAdapter');
const { OutlookAdapter } = await import('@/lib/email/adapters/OutlookAdapter');
const { SYNC_READ_LIMIT, toInboxBatch } = await import('@/lib/email/inboxBatch');
const { cursorAfter } = await import('@/workers/sync');

const T0 = Date.UTC(2026, 9, 9, 8, 0, 0);

/** Gmail lists newest first: id-N … id-1. */
function listPages(total: number, pageSize = 500) {
  const ids = Array.from({ length: total }, (_, i) => `id-${total - i}`);
  const pages: { messages: { id: string }[]; nextPageToken?: string }[] = [];
  for (let i = 0; i < ids.length; i += pageSize) {
    pages.push({ messages: ids.slice(i, i + pageSize).map((id) => ({ id })), nextPageToken: i + pageSize < ids.length ? `p${i + pageSize}` : undefined });
  }
  return pages;
}

function gmailMessage(id: string) {
  const n = Number(id.split('-')[1]);
  return {
    data: {
      id,
      internalDate: String(T0 + n * 1000),
      labelIds: ['INBOX'],
      payload: { headers: [{ name: 'From', value: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }, { name: 'Subject', value: 'Delivery Status Notification (Failure)' }] },
    },
  };
}

describe('Gmail sync paging', () => {
  beforeEach(() => {
    gmailList.mockReset();
    gmailGet.mockReset().mockImplementation(async ({ id }: { id: string }) => gmailMessage(id));
  });

  it('reads past the first 50 — every message since the cursor, oldest first', async () => {
    const pages = listPages(120);
    gmailList.mockImplementation(async ({ pageToken }: { pageToken?: string }) => ({ data: pages[pageToken ? 1 : 0] }));

    const batch = await new GmailAdapter({ accessToken: 'a', refreshToken: 'r' }).fetchMessagesSince(new Date(T0));

    expect(batch.truncated).toBe(false);
    expect(batch.messages).toHaveLength(120);
    expect(batch.messages[0].providerMessageId).toBe('id-1');
    expect(batch.messages[119].providerMessageId).toBe('id-120');
    expect(batch.messages[0].receivedAt?.getTime()).toBe(T0 + 1000);
  });

  it('follows every list page', async () => {
    const pages = listPages(1200);
    gmailList.mockImplementation(async ({ pageToken }: { pageToken?: string }) => ({
      data: pages[pageToken ? Number(pageToken.slice(1)) / 500 : 0],
    }));

    const batch = await new GmailAdapter({ accessToken: 'a', refreshToken: 'r' }).fetchMessagesSince(new Date(T0));

    expect(gmailList).toHaveBeenCalledTimes(3);
    // The oldest are read first, so what is left for the next run is only newer mail.
    expect(batch.messages[0].providerMessageId).toBe('id-1');
    expect(batch.messages).toHaveLength(SYNC_READ_LIMIT);
    expect(batch.truncated).toBe(true);
  });
});

describe('Outlook sync paging', () => {
  afterEach(() => vi.unstubAllGlobals());

  const graphMessage = (n: number) => ({
    id: `m-${n}`,
    from: { emailAddress: { address: 'postmaster@outlook.com', name: 'Postmaster' } },
    toRecipients: [{ emailAddress: { address: 'rep@acme.com' } }],
    subject: 'Undeliverable: hello',
    receivedDateTime: new Date(T0 + n * 1000).toISOString(),
    body: { contentType: 'text', content: 'x' },
  });

  it('asks oldest first and follows @odata.nextLink', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [1, 2].map(graphMessage), '@odata.nextLink': 'https://graph.example/next' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [3].map(graphMessage) })));
    vi.stubGlobal('fetch', fetchMock);

    const batch = await new OutlookAdapter({ accessToken: 't', refreshToken: 'r' } as never).fetchMessagesSince(new Date(T0));

    expect(String(fetchMock.mock.calls[0][0])).toContain('$orderby=receivedDateTime asc');
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.example/next');
    expect(batch).toMatchObject({ truncated: false });
    expect(batch.messages.map((m) => m.providerMessageId)).toEqual(['m-1', 'm-2', 'm-3']);
  });

  it('stops at the read limit and says so', async () => {
    const page = Array.from({ length: 100 }, (_, i) => graphMessage(i + 1));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ value: page, '@odata.nextLink': 'https://graph.example/next' }))));

    const batch = await new OutlookAdapter({ accessToken: 't', refreshToken: 'r' } as never).fetchMessagesSince(new Date(T0));

    expect(batch.messages).toHaveLength(SYNC_READ_LIMIT);
    expect(batch.truncated).toBe(true);
  });
});

describe('where the next run starts', () => {
  const since = new Date(T0);
  const now = new Date(T0 + 3_600_000);

  it('is the newest received time read, less a second', () => {
    const messages = [
      { providerMessageId: 'a', fromEmail: 'x@y.z', subject: '', date: new Date(0), receivedAt: new Date(T0 + 50_000) },
      { providerMessageId: 'b', fromEmail: 'x@y.z', subject: '', date: new Date(0), receivedAt: new Date(T0 + 90_000) },
    ];
    expect(cursorAfter(messages, since, now).getTime()).toBe(T0 + 89_000);
  });

  it('falls back to the Date header when no received time is known, and never goes back or forward past the run', () => {
    expect(cursorAfter([{ providerMessageId: 'a', fromEmail: '', subject: '', date: new Date(T0 + 10_000) }], since, now).getTime()).toBe(T0 + 9_000);
    expect(cursorAfter([{ providerMessageId: 'a', fromEmail: '', subject: '', date: new Date(T0 - 99_000) }], since, now).getTime()).toBe(T0);
    expect(cursorAfter([{ providerMessageId: 'a', fromEmail: '', subject: '', date: new Date(T0 + 9_999_000) }], since, now).getTime()).toBe(now.getTime());
  });

  it('treats a bare list from an adapter that does not page as complete', () => {
    expect(toInboxBatch([])).toEqual({ messages: [], truncated: false });
  });
});
