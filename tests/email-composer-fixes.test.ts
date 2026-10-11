/**
 * Email composer fixes, proved against the database (PR 1 of the composer plan, 2026-10-11).
 *
 *  - an inbox reply is refused where the rep can see it (suppressed, invalid address, paused or
 *    disconnected mailbox) and queues nothing;
 *  - a reply is idempotent on `clientRequestId` and remembers which prospect message it answers;
 *  - a one-off send fills {{sdrName}} / {{sdrTitle}} from the owner of the mailbox it leaves from,
 *    not from a placeholder and not from whoever pressed Send;
 *  - another tenant's lead is not reachable through either route.
 *
 * Only the session and the queue are stubbed; the routes, the gate and the rows are real.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

const session = { current: null as unknown };
const mockEnqueue = vi.fn();

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAuth: async () => session.current };
});
vi.mock('@/lib/workflows/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/email')>()),
  enqueueEmailSendWorkflow: (...a: unknown[]) => mockEnqueue(...a),
}));

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { POST as reply } from '@/app/api/inbox/threads/[id]/reply/route';
import { POST as send } from '@/app/api/email/send/route';
import type { SessionUser } from '@/lib/auth';
import { createTestTenant } from './helpers/testTenant';

interface World {
  tenantId: string;
  sdr: SessionUser;
  director: SessionUser;
  leadId: string;
  leadEmail: string;
  accountId: string;
  inboundId: string;
}

async function buildWorld(): Promise<World> {
  const tenantId = `tcf-${randomUUID()}`;
  await createTestTenant(tenantId, 'Composer fixes');
  return tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    const mkUser = (role: 'sdr' | 'director', firstName: string, lastName: string) =>
      prisma.user.create({
        data: { tenantId, email: `${firstName}.${randomUUID()}@t.test`, firstName, lastName, password: 'x', role },
      });
    const sdrRow = await mkUser('sdr', 'Mei', 'Tran');
    const directorRow = await mkUser('director', 'Dan', 'Boss');
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
    const leadEmail = `prospect.${randomUUID()}@acme.test`;
    const lead = await prisma.lead.create({
      data: { tenantId, firstName: 'Linh', lastName: 'Pham', email: leadEmail, company: 'Acme', assignedToId: sdrRow.id, campaignId: campaign.id },
    });
    const account = await prisma.emailAccount.create({
      data: { tenantId, userId: sdrRow.id, email: `mei.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true },
    });
    const inbound = await prisma.inboundMessage.create({
      data: {
        tenantId,
        accountId: account.id,
        leadId: lead.id,
        fromEmail: leadEmail,
        to: account.email,
        subject: 'Re: Intro',
        body: 'Sounds interesting',
        providerMessageId: `pm-${randomUUID()}`,
        rfcMessageId: '<prospect-1@mail.acme.test>',
        referencesHeader: '<root@t.test>',
        date: new Date(),
      },
    });
    const asSession = (u: typeof sdrRow): SessionUser => ({
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role as SessionUser['role'], tenantId,
    });
    return {
      tenantId,
      sdr: asSession(sdrRow),
      director: asSession(directorRow),
      leadId: lead.id,
      leadEmail,
      accountId: account.id,
      inboundId: inbound.id,
    };
  });
}

const post = (url: string, body: unknown) =>
  new NextRequest(new Request(`https://crm.test${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('inbox reply gates and threading', () => {
  let w: World;
  const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: w.tenantId, bypassRls: true }, fn);
  const doReply = (extra: Record<string, unknown> = {}, asUser: SessionUser = w.sdr) => {
    session.current = asUser;
    return inTenant(() =>
      reply(post('/api/inbox/threads/t/reply', { leadId: w.leadId, body: 'Thanks, Linh.', subject: 'Intro', ...extra }), {
        params: Promise.resolve({ id: `${w.leadId}-intro` }),
      })
    );
  };
  const outboundCount = () => inTenant(() => prisma.outboundMessage.count({ where: { tenantId: w.tenantId } }));

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue('job-1');
    w = await buildWorld();
  });

  it('queues a reply that remembers the prospect message it answers', async () => {
    const res = await doReply({ clientRequestId: 'req-aaaaaaaa' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe('Reply queued');
    const row = await inTenant(() => prisma.outboundMessage.findUniqueOrThrow({ where: { id: json.outboundMessage.id } }));
    expect(row.inReplyToInboundId).toBe(w.inboundId);
    expect(row.status).toBe('pending');
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on clientRequestId: a retry resolves to the same message', async () => {
    const first = await (await doReply({ clientRequestId: 'req-bbbbbbbb' })).json();
    const second = await (await doReply({ clientRequestId: 'req-bbbbbbbb' })).json();

    expect(second.outboundMessage.id).toBe(first.outboundMessage.id);
    expect(await outboundCount()).toBe(1);
  });

  it('a different clientRequestId is a different reply', async () => {
    await doReply({ clientRequestId: 'req-cccccccc' });
    await doReply({ clientRequestId: 'req-dddddddd' });
    expect(await outboundCount()).toBe(2);
  });

  it('refuses a suppressed recipient with a code and queues nothing', async () => {
    await inTenant(() => prisma.suppressionEntry.create({ data: { tenantId: w.tenantId, email: w.leadEmail, reason: 'unsubscribed' } }));

    const res = await doReply();

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('recipient_suppressed');
    expect(await outboundCount()).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses a do-not-contact domain (manual suppression) the same way', async () => {
    const domain = w.leadEmail.split('@')[1];
    await inTenant(() => prisma.suppressionEntry.create({ data: { tenantId: w.tenantId, domain, reason: 'manual' } }));

    const res = await doReply();

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('recipient_suppressed');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses an address already marked invalid', async () => {
    await inTenant(() => prisma.lead.update({ where: { id: w.leadId }, data: { emailInvalid: true } }));

    const res = await doReply();

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('recipient_invalid');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses a paused mailbox with the reason, and queues nothing', async () => {
    await inTenant(() =>
      prisma.emailAccount.update({ where: { id: w.accountId }, data: { sendPausedAt: new Date(), sendPauseReason: 'bounce spike' } })
    );

    const res = await doReply();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('mailbox_paused');
    expect(json.error).toContain('bounce spike');
    expect(await outboundCount()).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('says a disconnected mailbox is disconnected, with a 4xx', async () => {
    await inTenant(() => prisma.emailAccount.update({ where: { id: w.accountId }, data: { isActive: false } }));

    const res = await doReply();

    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does not reach another tenant’s lead', async () => {
    const other = await buildWorld();
    session.current = other.sdr;

    const res = await tenantStorage.run({ tenantId: other.tenantId, bypassRls: true }, () =>
      reply(post('/api/inbox/threads/t/reply', { leadId: w.leadId, body: 'hi', subject: 'Intro' }), {
        params: Promise.resolve({ id: `${w.leadId}-intro` }),
      })
    );

    expect(res.status).toBe(404);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('one-off send fills merge fields from the mailbox owner', () => {
  let w: World;
  beforeEach(async () => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue('job-1');
    w = await buildWorld();
  });

  it('uses the owner’s name and title, not a placeholder and not the person who pressed Send', async () => {
    session.current = w.director;

    const res = await tenantStorage.run({ tenantId: w.tenantId, bypassRls: true }, () =>
      send(post('/api/email/send', {
        accountId: w.accountId,
        to: w.leadEmail,
        leadId: w.leadId,
        subject: 'Hello {{firstName}}',
        body: 'Hi {{firstName}},\n\nRegards,\n{{sdrName}}, {{sdrTitle}}',
        clientRequestId: `req-${randomUUID()}`,
      }))
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    const row = await tenantStorage.run({ tenantId: w.tenantId, bypassRls: true }, () =>
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: json.outboundMessageId } })
    );
    expect(row.subject).toBe('Hello Linh');
    expect(row.body).toContain('Mei Tran, Sales Development Representative');
    expect(row.body).not.toContain('Dan Boss');
    expect(row.body).not.toMatch(/\bSDR\b(?!\w)/);
  });

  it('refuses a paused mailbox whichever mailbox the rep picked, with a code', async () => {
    session.current = w.director;
    await tenantStorage.run({ tenantId: w.tenantId, bypassRls: true }, () =>
      prisma.emailAccount.update({ where: { id: w.accountId }, data: { sendPausedAt: new Date() } })
    );

    const res = await tenantStorage.run({ tenantId: w.tenantId, bypassRls: true }, () =>
      send(post('/api/email/send', { accountId: w.accountId, to: w.leadEmail, leadId: w.leadId, subject: 's', body: 'b' }))
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('mailbox_paused');
  });
});
