import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { SENDER_NAME_MAX, fromHeaderValue, normalizeSenderName } from '@/lib/email/senderName';

/**
 * Per-mailbox sender name — "nhiều mail tên Brandon quá" (owner, 2026-10-02).
 *
 * Every send put the bare address in From:, so the name prospects saw was whatever the provider had
 * on the account profile. The name is now set per mailbox. Because it lands in a mail header, the
 * tests below care as much about what it must not do — open a new header — as about what it shows.
 */

const findUnique = vi.fn();
const update = vi.fn();
const sessionUser = { current: { id: 'user-judy', role: 'sdr', tenantId: 't1', email: 'judy@t.test', firstName: 'Judy', lastName: 'N' } };

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailAccount: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => sessionUser.current,
}));

import { PATCH } from '@/app/api/email/accounts/[id]/route';

async function compile(from: ReturnType<typeof fromHeaderValue>): Promise<string> {
  const MailComposer = (await import('nodemailer/lib/mail-composer')).default;
  const message = await new MailComposer({ from, to: 'prospect@example.com', subject: 'Hi', text: 'Hello' }).compile().build();
  return message.toString('utf8');
}

describe('normalizeSenderName', () => {
  it('keeps a real name, Vietnamese included', () => {
    expect(normalizeSenderName('  Judy   Nguyen ')).toBe('Judy Nguyen');
    expect(normalizeSenderName('Nguyễn Thị Lan')).toBe('Nguyễn Thị Lan');
  });

  it('removes what could break out of the header', () => {
    expect(normalizeSenderName('Judy\r\nBcc: attacker@evil.test')).toBe('Judy Bcc: attacker@evil.test');
    expect(normalizeSenderName('Judy <ceo@other.test>')).toBe('Judy ceo@other.test');
    expect(normalizeSenderName('"Judy"')).toBe('Judy');
  });

  it('treats empty as no name and caps the length', () => {
    expect(normalizeSenderName('   ')).toBeNull();
    expect(normalizeSenderName(null)).toBeNull();
    expect(normalizeSenderName('x'.repeat(200))).toHaveLength(SENDER_NAME_MAX);
  });
});

describe('the From header a prospect receives', () => {
  it('carries the name next to the address', async () => {
    const mime = await compile(fromHeaderValue('judy@telestar.cloud', 'Judy Nguyen'));
    expect(mime).toMatch(/^From: Judy Nguyen <judy@telestar\.cloud>$/m);
  });

  it('stays the bare address when no name is set — unchanged from before', async () => {
    const mime = await compile(fromHeaderValue('judy@telestar.cloud', null));
    expect(mime).toMatch(/^From: judy@telestar\.cloud$/m);
  });

  it('encodes a non-ASCII name instead of sending raw bytes', async () => {
    const mime = await compile(fromHeaderValue('lan@telestar.cloud', 'Nguyễn Thị Lan'));
    expect(mime).toMatch(/^From: =\?UTF-8\?/m);
  });

  it('cannot be used to add a Bcc header', async () => {
    const mime = await compile(fromHeaderValue('judy@telestar.cloud', 'Judy\r\nBcc: attacker@evil.test'));
    expect(mime).not.toMatch(/^Bcc:/m);
  });
});

describe('PATCH /api/email/accounts/[id]', () => {
  const call = (body: unknown) =>
    PATCH(
      new NextRequest('http://localhost/api/email/accounts/acc-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'acc-1' }) }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ id: 'acc-1', userId: 'user-judy' });
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'acc-1', ...data }));
  });

  it('saves a sender name without touching the signature — it used to write "undefined"', async () => {
    const res = await call({ fromName: '  Judy  Nguyen ' });

    expect(res.status).toBe(200);
    const { data } = update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toEqual({ fromName: 'Judy Nguyen' });
    expect('signature' in data).toBe(false);
  });

  it('clears the name when sent empty', async () => {
    await call({ fromName: '   ' });
    expect((update.mock.calls[0][0] as { data: unknown }).data).toEqual({ fromName: null });
  });

  it('refuses a mailbox that belongs to someone else', async () => {
    findUnique.mockResolvedValue({ id: 'acc-1', userId: 'user-other' });
    const res = await call({ fromName: 'Not Mine' });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an empty update and unknown fields', async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ email: 'hijack@evil.test' })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('the send path carries the name all the way out', () => {
  // There is one place a sequence or manual email leaves the CRM (workers/email.ts) and three
  // adapters it can leave through. Dropping the name at either hop would silently put every email
  // back on the provider's profile name, which is the defect this exists to fix.
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('the email worker hands the mailbox name to the adapter', () => {
    expect(read('workers/email.ts')).toContain('fromName: account.fromName');
  });

  it.each(['GmailAdapter', 'OutlookAdapter', 'ImapAdapter'])('%s builds From from the name', (adapter) => {
    expect(read(`lib/email/adapters/${adapter}.ts`)).toContain('from: fromHeaderValue(options.from, options.fromName)');
  });
});
