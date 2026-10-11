/**
 * Outlook sends report the RFC Message-ID, so a later sequence step or inbox reply can thread.
 *
 * Graph's `sendMail` answers 202 with no body. The adapter now puts its own Message-ID in the MIME
 * and reads the sent copy back from Sent Items (Mail.Read, which connected mailboxes have). Graph
 * is mocked here; the live behaviour is checked against a real mailbox (see the PR).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OutlookAdapter } from '@/lib/email/adapters/OutlookAdapter';

type Call = { url: string; method: string; body?: string };

function mockGraph(routes: (call: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const call = { url: String(url), method: init?.method ?? 'GET', body: init?.body };
      calls.push(call);
      const out = routes(call);
      return {
        ok: out.status >= 200 && out.status < 300,
        status: out.status,
        statusText: String(out.status),
        json: async () => out.json ?? {},
      } as unknown as Response;
    })
  );
  return calls;
}

const adapter = () =>
  new OutlookAdapter({ accessToken: 'tok', refreshToken: 'ref', sentLookupDelaysMs: [0, 0] });

const SEND = {
  from: 'mei@acme-outlook.test',
  fromName: 'Mei',
  to: 'linh@prospect.test',
  subject: 'Quick question',
  text: 'Hello Linh',
};

const decodedMime = (calls: Call[]) =>
  Buffer.from(calls.find((c) => c.url.endsWith('/me/sendMail'))!.body!, 'base64').toString('utf8');

describe('OutlookAdapter.send', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the Message-ID Graph reports for the message it sent', async () => {
    let ownId = '';
    const calls = mockGraph((c) => {
      if (c.url.endsWith('/me/sendMail')) return { status: 202 };
      ownId = /Message-ID: (<[^>]+>)/i.exec(Buffer.from(calls[0].body!, 'base64').toString('utf8'))?.[1] ?? '';
      return { status: 200, json: { value: [{ internetMessageId: ownId }] } };
    });

    const receipt = await adapter().send(SEND);

    expect(ownId).toMatch(/^<[0-9a-f-]+@acme-outlook\.test>$/);
    expect(receipt).toEqual({ providerMessageId: ownId, rfcMessageId: ownId });
    // The lookup went to Sent Items and asked for exactly the id we put in the MIME.
    const lookup = calls.find((c) => c.url.includes('/mailFolders/sentitems/messages'))!;
    expect(decodeURIComponent(lookup.url)).toContain(`internetMessageId eq '${ownId}'`);
  });

  it('uses the id Exchange assigned when it rewrote ours (matched on recipient, subject, time)', async () => {
    mockGraph((c) => {
      if (c.url.endsWith('/me/sendMail')) return { status: 202 };
      if (decodeURIComponent(c.url).includes('internetMessageId eq')) return { status: 200, json: { value: [] } };
      return {
        status: 200,
        json: {
          value: [
            { internetMessageId: '<other@x>', subject: 'Something else', toRecipients: [{ emailAddress: { address: 'linh@prospect.test' } }] },
            { internetMessageId: '<exchange-assigned@outlook.com>', subject: 'Quick question', toRecipients: [{ emailAddress: { address: 'Linh@Prospect.test' } }] },
          ],
        },
      };
    });

    const receipt = await adapter().send(SEND);

    expect(receipt).toEqual({ providerMessageId: '<exchange-assigned@outlook.com>', rfcMessageId: '<exchange-assigned@outlook.com>' });
  });

  it('still succeeds, with no id, when Sent Items cannot be read', async () => {
    mockGraph((c) => (c.url.endsWith('/me/sendMail') ? { status: 202 } : { status: 403, json: { error: { message: 'denied' } } }));

    const receipt = await adapter().send(SEND);

    expect(receipt).toEqual({});
  });

  it('does not invent an id when the sent copy is not there yet', async () => {
    mockGraph((c) => (c.url.endsWith('/me/sendMail') ? { status: 202 } : { status: 200, json: { value: [] } }));

    expect(await adapter().send(SEND)).toEqual({});
  });

  it('throws on a refused send and never looks in Sent Items', async () => {
    const calls = mockGraph(() => ({ status: 400, json: { error: { message: 'Invalid recipient' } } }));

    await expect(adapter().send(SEND)).rejects.toThrow('Microsoft Graph API error: Invalid recipient');
    expect(calls.filter((c) => c.url.includes('sentitems'))).toHaveLength(0);
  });

  it('carries the thread headers of a reply in the MIME', async () => {
    const calls = mockGraph((c) => (c.url.endsWith('/me/sendMail') ? { status: 202 } : { status: 200, json: { value: [] } }));

    await adapter().send({
      ...SEND,
      threading: { inReplyTo: '<prospect-1@mail.acme.test>', references: '<root@t.test> <prospect-1@mail.acme.test>' },
    });

    const mime = decodedMime(calls);
    expect(mime).toMatch(/In-Reply-To: <prospect-1@mail\.acme\.test>/i);
    expect(mime).toMatch(/References: <root@t\.test> <prospect-1@mail\.acme\.test>/i);
  });
});

describe('OutlookAdapter.fetchMessagesSince', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores the Message-ID and References of a received message', async () => {
    const calls = mockGraph(() => ({
      status: 200,
      json: {
        value: [
          {
            id: 'graph-1',
            from: { emailAddress: { address: 'Linh@Prospect.test', name: 'Linh' } },
            toRecipients: [{ emailAddress: { address: 'mei@acme-outlook.test' } }],
            subject: 'Re: Quick question',
            receivedDateTime: '2026-10-11T10:00:00Z',
            body: { contentType: 'text', content: 'Yes please' },
            internetMessageId: '<prospect-1@mail.prospect.test>',
            internetMessageHeaders: [
              { name: 'References', value: '<ours-1@acme-outlook.test>' },
              { name: 'X-Other', value: 'x' },
            ],
          },
        ],
      },
    }));

    const batch = await adapter().fetchMessagesSince(new Date('2026-10-11T00:00:00Z'));

    expect(decodeURIComponent(calls[0].url)).toContain('internetMessageId');
    expect(batch.messages[0]).toMatchObject({
      rfcMessageId: '<prospect-1@mail.prospect.test>',
      referencesHeader: '<ours-1@acme-outlook.test>',
    });
  });
});
