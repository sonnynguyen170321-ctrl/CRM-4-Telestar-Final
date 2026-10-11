/**
 * The shared composer's server side (PR 2), proved against the database. Only the session and the
 * queue are stubbed; the routes, the gates and the rows are real.
 *
 *  - GET/POST /api/email/preview: tenant + lead access, real sender, missing values;
 *  - CC / BCC: validated, de-duplicated, suppression-checked, stored for the worker;
 *  - ad-hoc attachments: allowlist, size, ownership, tenant isolation, binding, idempotent retry;
 *  - HTML bodies: sanitised, pasted images become inline attachments;
 *  - snippets: personal vs shared permissions and tenant isolation.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { GET as previewGet, POST as previewPost } from '@/app/api/email/preview/route';
import { POST as send } from '@/app/api/email/send/route';
import { POST as reply } from '@/app/api/inbox/threads/[id]/reply/route';
import { GET as accountsGet } from '@/app/api/email/accounts/route';
import { POST as uploadAttachment } from '@/app/api/email/attachments/route';
import { DELETE as deleteAttachment } from '@/app/api/email/attachments/[id]/route';
import { GET as snippetsGet, POST as snippetsPost } from '@/app/api/snippets/route';
import { PATCH as snippetPatch, DELETE as snippetDelete } from '@/app/api/snippets/[id]/route';
import type { SessionUser } from '@/lib/auth';

interface Tenant {
  tenantId: string;
  sdr: SessionUser;
  otherSdr: SessionUser;
  director: SessionUser;
  leadId: string;
  leadEmail: string;
  accountId: string;
  otherAccountId: string;
  campaignId: string;
  inboundId: string;
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

// One world per file (it is read-only for most tests), removed in afterAll; the cascade clears the rest.
const createdTenants: string[] = [];

async function buildTenant(label: string): Promise<Tenant> {
  const tenantId = `tcr-${label}-${randomUUID()}`;
  await prisma.tenant.create({ data: { id: tenantId, name: `Compose routes ${label}` } });
  createdTenants.push(tenantId);
  return tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    const mkUser = (role: 'sdr' | 'director', firstName: string, lastName: string) =>
      prisma.user.create({
        data: { tenantId, email: `${firstName}.${randomUUID()}@t.test`, firstName, lastName, password: 'x', role },
      });
    const sdrRow = await mkUser('sdr', 'Mei', 'Tran');
    const otherRow = await mkUser('sdr', 'Bao', 'Le');
    const directorRow = await mkUser('director', 'Dan', 'Boss');
    const client = await prisma.client.create({
      data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
    const leadEmail = `prospect.${randomUUID()}@acme.test`;
    const lead = await prisma.lead.create({
      // No last name and no title: the preview must say so.
      data: { tenantId, firstName: 'Linh', lastName: '', email: leadEmail, company: 'Acme', assignedToId: sdrRow.id, campaignId: campaign.id },
    });
    const account = await prisma.emailAccount.create({
      data: { tenantId, userId: sdrRow.id, email: `mei.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true, signature: '<p>Mei Tran<br>Telestar</p>' },
    });
    const otherAccount = await prisma.emailAccount.create({
      data: { tenantId, userId: otherRow.id, email: `bao.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true },
    });
    const inbound = await prisma.inboundMessage.create({
      data: {
        tenantId, accountId: account.id, leadId: lead.id, fromEmail: leadEmail, to: account.email, subject: 'Re: Intro',
        body: 'Sounds interesting', providerMessageId: `pm-${randomUUID()}`, rfcMessageId: '<p1@mail.acme.test>', date: new Date(),
      },
    });
    const asSession = (u: typeof sdrRow): SessionUser => ({
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role as SessionUser['role'], tenantId,
    });
    return {
      tenantId,
      sdr: asSession(sdrRow),
      otherSdr: asSession(otherRow),
      director: asSession(directorRow),
      leadId: lead.id,
      leadEmail,
      accountId: account.id,
      otherAccountId: otherAccount.id,
      campaignId: campaign.id,
      inboundId: inbound.id,
    };
  });
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(new Request(`https://crm.test${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));

const upload = (name: string, bytes: Buffer, type = 'application/octet-stream') => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], name, { type }));
  return new NextRequest(new Request('https://crm.test/api/email/attachments', { method: 'POST', body: form }));
};

let a: Tenant;
let b: Tenant;
const as = (user: SessionUser) => { session.current = user; };
const inA = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: a.tenantId, bypassRls: true }, fn);
const inB = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: b.tenantId, bypassRls: true }, fn);

beforeAll(async () => {
  a = await buildTenant('a');
  b = await buildTenant('b');
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenants } } });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueue.mockResolvedValue('job-1');
});

// ─── Preview as this lead ────────────────────────────────────────────────────

describe('preview as this lead', () => {
  const body = '<p>Hi {{firstName}} {{lastName}}, from {{sdrName}} ({{sdrTitle}}) at {{company}}. {{title|your role}}</p>';
  const preview = (user: SessionUser, extra: Record<string, unknown> = {}) => {
    as(user);
    return inA(() => previewPost(json('/api/email/preview', 'POST', { leadId: a.leadId, accountId: a.accountId, subject: 'For {{firstName}}', body, ...extra })));
  };

  it('renders with the real lead and the mailbox owner as sender, not the signed-in manager', async () => {
    const res = await preview(a.sdr);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.subject).toBe('For Linh');
    expect(data.bodyHtml).toContain('Hi Linh , from Mei Tran (Sales Development Representative) at Acme. your role');
    expect(data.sender).toEqual({ name: 'Mei Tran', email: expect.stringContaining('@t.test') });
  });

  it('lists the merge fields the lead has no value for, and not the ones with a fallback', async () => {
    const data = await (await preview(a.sdr)).json();
    expect(data.missing).toEqual([{ field: 'lastName', raw: '{{lastName}}', where: 'body' }]);
  });

  it('a director previewing for a rep still uses that rep as the sender when given their mailbox', async () => {
    const data = await (await preview(a.director)).json();
    expect(data.sender.name).toBe('Mei Tran');
  });

  it('refuses a rep who cannot open the lead', async () => {
    expect((await preview(a.otherSdr, { accountId: a.otherAccountId })).status).toBe(403);
  });

  it('does not reveal a lead of another tenant', async () => {
    as(b.sdr);
    const res = await inB(() => previewPost(json('/api/email/preview', 'POST', { leadId: a.leadId, body })));
    expect(res.status).toBe(404);
  });

  it('refuses a mailbox the caller may not send from', async () => {
    expect((await preview(a.sdr, { accountId: a.otherAccountId })).status).toBe(404);
  });

  it('renders a template, but not a colleague\'s private one', async () => {
    const privateTemplate = await inA(() =>
      prisma.template.create({ data: { tenantId: a.tenantId, name: 'Mine', channel: 'email', subject: 'Hello {{firstName}}', body: '<p>Hey {{firstName}}</p>', createdById: a.otherSdr.id } }),
    );
    const sharedTemplate = await inA(() =>
      prisma.template.create({ data: { tenantId: a.tenantId, name: 'Shared', channel: 'email', subject: 'Hello {{firstName}}', body: '<p>Hey {{firstName}}</p>', createdById: a.otherSdr.id, isShared: true } }),
    );
    as(a.sdr);
    const hidden = await inA(() => previewGet(json(`/api/email/preview?leadId=${a.leadId}&templateId=${privateTemplate.id}`, 'GET')));
    expect(hidden.status).toBe(404);
    const shown = await inA(() => previewGet(json(`/api/email/preview?leadId=${a.leadId}&templateId=${sharedTemplate.id}`, 'GET')));
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({ subject: 'Hello Linh', bodyHtml: '<p>Hey Linh</p>' });
  });

  it('is HTML-safe: a hostile company name arrives as text', async () => {
    await inA(() => prisma.lead.update({ where: { id: a.leadId }, data: { company: '<img src=x onerror=alert(1)>' } }));
    try {
      const data = await (await preview(a.sdr)).json();
      expect(data.bodyHtml).not.toMatch(/<img/i);
      expect(data.bodyHtml).toContain('&lt;img');
    } finally {
      await inA(() => prisma.lead.update({ where: { id: a.leadId }, data: { company: 'Acme' } }));
    }
  });

  it('needs a lead and a body or a template', async () => {
    as(a.sdr);
    expect((await inA(() => previewPost(json('/api/email/preview', 'POST', { leadId: a.leadId })))).status).toBe(400);
    expect((await inA(() => previewGet(json('/api/email/preview?body=x', 'GET')))).status).toBe(400);
  });
});

// ─── Mailbox list ────────────────────────────────────────────────────────────

describe('GET /api/email/accounts', () => {
  it('gives the composer health, remaining quota and a displayable signature, and no credentials', async () => {
    as(a.sdr);
    const res = await inA(() => accountsGet(json('/api/email/accounts', 'GET')));
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0].quota).toMatchObject({ dailyRemaining: expect.any(Number), hourlyRemaining: expect.any(Number) });
    expect(list[0].signaturePreview).toContain('Mei Tran');
    expect(list[0]).not.toHaveProperty('signatureImages');
    expect(JSON.stringify(list)).not.toMatch(/encPassword|encAccessToken|encRefreshToken/);
  });
});

// ─── CC / BCC ────────────────────────────────────────────────────────────────

describe('CC and BCC on a one-off send', () => {
  const sendBody = (extra: Record<string, unknown> = {}) => ({
    accountId: a.accountId, to: a.leadEmail, subject: 'Hello', body: 'Hi there', leadId: a.leadId, clientRequestId: `req-${randomUUID()}`, ...extra,
  });
  const doSend = (extra: Record<string, unknown> = {}) => { as(a.sdr); return inA(() => send(json('/api/email/send', 'POST', sendBody(extra)))); };
  const rowFor = async (id: string) => inA(() => prisma.outboundMessage.findUniqueOrThrow({ where: { id } }));

  it('stores lower-cased, de-duplicated copies with the main recipient and CC members removed', async () => {
    const res = await doSend({ cc: ['Boss@T.test', 'boss@t.test', a.leadEmail], bcc: ['audit@t.test', 'boss@t.test'] });
    expect(res.status).toBe(200);
    const row = await rowFor((await res.json()).outboundMessageId);
    expect(row.cc).toEqual(['boss@t.test']);
    expect(row.bcc).toEqual(['audit@t.test']);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('refuses an invalid address, a header-injection attempt and more than ten, queuing nothing', async () => {
    for (const bad of [{ cc: ['not-an-email'] }, { bcc: ['a@b.test\r\nBcc: x@y.test'] }, { cc: Array.from({ length: 11 }, (_, i) => `u${i}@t.test`) }]) {
      const res = await doSend(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses a suppressed copy by name and queues nothing', async () => {
    await inA(() => prisma.suppressionEntry.create({ data: { tenantId: a.tenantId, email: 'optout@t.test', reason: 'unsubscribed' } }));
    const res = await doSend({ cc: ['optout@t.test'] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('optout@t.test');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('a send with no copies writes the empty lists', async () => {
    const row = await rowFor((await (await doSend()).json()).outboundMessageId);
    expect(row.cc).toEqual([]);
    expect(row.bcc).toEqual([]);
  });
});

// ─── Attachments ─────────────────────────────────────────────────────────────

describe('ad-hoc attachments', () => {
  const up = async (user: SessionUser, name: string, bytes: Buffer, tenant: 'a' | 'b' = 'a') => {
    as(user);
    return (tenant === 'a' ? inA : inB)(() => uploadAttachment(upload(name, bytes)));
  };
  const sendWith = (extra: Record<string, unknown>, user: SessionUser = a.sdr) => {
    as(user);
    return inA(() => send(json('/api/email/send', 'POST', {
      accountId: a.accountId, to: a.leadEmail, subject: 'Docs', body: 'See attached', leadId: a.leadId, clientRequestId: `req-${randomUUID()}`, ...extra,
    })));
  };

  it('stores an allowed file unbound, typed by its extension and not by the browser', async () => {
    const res = await up(a.sdr, 'Brochure.pdf', PDF, 'a');
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ name: 'Brochure.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
    const row = await inA(() => prisma.attachment.findUniqueOrThrow({ where: { id: created.id } }));
    expect(row).toMatchObject({ templateId: null, outboundMessageId: null, uploadedById: a.sdr.id, tenantId: a.tenantId });
  });

  it('refuses a disallowed type, a file that is not what its name says, and an empty upload', async () => {
    expect((await up(a.sdr, 'run.exe', Buffer.from('MZ'))).status).toBe(400);
    expect((await up(a.sdr, 'fake.pdf', Buffer.from('MZ\x90\x00'))).status).toBe(400);
    expect((await up(a.sdr, 'page.html', Buffer.from('<b>x</b>'))).status).toBe(400);
    as(a.sdr);
    const none = await inA(() => uploadAttachment(new NextRequest(new Request('https://crm.test/api/email/attachments', { method: 'POST', body: new FormData() }))));
    expect(none.status).toBe(400);
  });

  it('refuses a single file over 10 MB', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await up(a.sdr, 'big.pdf', big)).status).toBe(400);
  });

  it('binds the caller\'s uploads to the message it creates, before it is queued', async () => {
    const att = await (await up(a.sdr, 'one.pdf', PDF)).json();
    const res = await sendWith({ attachmentIds: [att.id] });
    expect(res.status).toBe(200);
    const { outboundMessageId } = await res.json();
    const row = await inA(() => prisma.attachment.findUniqueOrThrow({ where: { id: att.id } }));
    expect(row.outboundMessageId).toBe(outboundMessageId);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('a retried request with the same id attaches once and queues the same message', async () => {
    const att = await (await up(a.sdr, 'retry.pdf', PDF)).json();
    const clientRequestId = `req-${randomUUID()}`;
    const first = await (await sendWith({ attachmentIds: [att.id], clientRequestId })).json();
    const second = await sendWith({ attachmentIds: [att.id], clientRequestId });
    expect(second.status).toBe(200);
    expect((await second.json()).outboundMessageId).toBe(first.outboundMessageId);
    const count = await inA(() => prisma.attachment.count({ where: { outboundMessageId: first.outboundMessageId } }));
    expect(count).toBe(1);
  });

  it('will not attach another rep\'s upload, and says nothing about it', async () => {
    const theirs = await (await up(a.otherSdr, 'theirs.pdf', PDF)).json();
    const res = await sendWith({ attachmentIds: [theirs.id] });
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
    const row = await inA(() => prisma.attachment.findUniqueOrThrow({ where: { id: theirs.id } }));
    expect(row.outboundMessageId).toBeNull();
  });

  it('will not attach another tenant\'s upload', async () => {
    const foreign = await (await up(b.sdr, 'foreign.pdf', PDF, 'b')).json();
    const res = await sendWith({ attachmentIds: [foreign.id] });
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('will not attach a template\'s attachment, and will not move a sent one', async () => {
    const template = await inA(() => prisma.template.create({ data: { tenantId: a.tenantId, name: 'T', channel: 'email', body: 'x', createdById: a.sdr.id } }));
    const tplAtt = await inA(() => prisma.attachment.create({ data: { tenantId: a.tenantId, templateId: template.id, uploadedById: a.sdr.id, name: 't.pdf', contentType: 'application/pdf', content: PDF.toString('base64'), sizeBytes: PDF.length } }));
    expect((await sendWith({ attachmentIds: [tplAtt.id] })).status).toBe(400);

    const att = await (await up(a.sdr, 'once.pdf', PDF)).json();
    expect((await sendWith({ attachmentIds: [att.id] })).status).toBe(200);
    const again = await sendWith({ attachmentIds: [att.id] });
    expect(again.status).toBe(409);
  });

  it('enforces the 10 MB total on the server', async () => {
    const six = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]);
    const first = await (await up(a.sdr, 'six-a.pdf', six)).json();
    const second = await (await up(a.sdr, 'six-b.pdf', six)).json();
    const res = await sendWith({ attachmentIds: [first.id, second.id] });
    expect(res.status).toBe(413);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('lets the owner remove an unsent upload and nobody else', async () => {
    const att = await (await up(a.sdr, 'del.pdf', PDF)).json();
    as(a.otherSdr);
    expect((await inA(() => deleteAttachment(json(`/api/email/attachments/${att.id}`, 'DELETE'), { params: Promise.resolve({ id: att.id }) }))).status).toBe(404);
    as(a.sdr);
    expect((await inA(() => deleteAttachment(json(`/api/email/attachments/${att.id}`, 'DELETE'), { params: Promise.resolve({ id: att.id }) }))).status).toBe(200);
  });

  it('does not delete a file already sent with a message', async () => {
    const att = await (await up(a.sdr, 'sent.pdf', PDF)).json();
    await sendWith({ attachmentIds: [att.id] });
    as(a.sdr);
    expect((await inA(() => deleteAttachment(json(`/api/email/attachments/${att.id}`, 'DELETE'), { params: Promise.resolve({ id: att.id }) }))).status).toBe(404);
  });

  it('turns a pasted image into an inline attachment and sanitises the body', async () => {
    const dataUri = `data:image/png;base64,${PNG.toString('base64')}`;
    const html = `<p onclick="x()">Hi</p><script>alert(1)</script><p><img src="${dataUri}"></p>`;
    const res = await sendWith({ body: html });
    expect(res.status).toBe(200);
    const { outboundMessageId } = await res.json();
    const out = await inA(() => prisma.outboundMessage.findUniqueOrThrow({ where: { id: outboundMessageId } }));
    expect(out.body).not.toMatch(/script|onclick|data:image/i);
    const cid = /src="cid:([^"]+)"/.exec(out.body ?? '')?.[1];
    expect(cid).toBeTruthy();
    const inline = await inA(() => prisma.attachment.findMany({ where: { outboundMessageId } }));
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({ cid, contentType: 'image/png', templateId: null });
  });

  it('refuses a body that is only empty paragraphs', async () => {
    const res = await sendWith({ body: '<p></p><p><br></p>' });
    expect(res.status).toBe(400);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ─── Inbox reply ─────────────────────────────────────────────────────────────

describe('inbox reply with copies and attachments', () => {
  it('carries CC, BCC and an attachment to the queued reply, and sanitises the editor HTML', async () => {
    as(a.sdr);
    const att = await (await inA(() => uploadAttachment(upload('reply.pdf', PDF)))).json();
    const res = await inA(() =>
      reply(json('/api/inbox/threads/t/reply', 'POST', {
        leadId: a.leadId, subject: 'Intro', body: '<p>Thanks</p><script>x()</script>', clientRequestId: `req-${randomUUID()}`,
        cc: ['manager@t.test'], bcc: ['audit@t.test'], attachmentIds: [att.id],
      }), { params: Promise.resolve({ id: `${a.leadId}-intro` }) }),
    );
    expect(res.status).toBe(200);
    const { outboundMessage } = await res.json();
    const row = await inA(() => prisma.outboundMessage.findUniqueOrThrow({ where: { id: outboundMessage.id } }));
    expect(row.cc).toEqual(['manager@t.test']);
    expect(row.bcc).toEqual(['audit@t.test']);
    expect(row.body).toBe('<p>Thanks</p>');
    const bound = await inA(() => prisma.attachment.findUniqueOrThrow({ where: { id: att.id } }));
    expect(bound.outboundMessageId).toBe(row.id);
  });
});

// ─── Snippets ────────────────────────────────────────────────────────────────

describe('snippets', () => {
  const call = <T>(user: SessionUser, run: () => Promise<T>, tenant: 'a' | 'b' = 'a') => { as(user); return (tenant === 'a' ? inA : inB)(run); };
  const create = (user: SessionUser, body: Record<string, unknown>, tenant: 'a' | 'b' = 'a') =>
    call(user, () => snippetsPost(json('/api/snippets', 'POST', body)), tenant);
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it('keeps a personal snippet private to its owner - not even a director sees it', async () => {
    const made = await (await create(a.sdr, { name: 'Meeting ask', bodyHtml: '<p>Do you have <strong>15 minutes</strong>?</p>' })).json();
    expect(made).toMatchObject({ isShared: false, ownerUserId: a.sdr.id, canManage: true });

    const names = async (user: SessionUser) => (await (await call(user, () => snippetsGet(json('/api/snippets', 'GET')))).json()).map((s: { id: string }) => s.id);
    expect(await names(a.sdr)).toContain(made.id);
    expect(await names(a.otherSdr)).not.toContain(made.id);
    expect(await names(a.director)).not.toContain(made.id);

    expect((await call(a.otherSdr, () => snippetPatch(json(`/api/snippets/${made.id}`, 'PATCH', { name: 'x' }), ctx(made.id)))).status).toBe(404);
    expect((await call(a.director, () => snippetDelete(json(`/api/snippets/${made.id}`, 'DELETE'), ctx(made.id)))).status).toBe(404);
  });

  it('lets only a manager share a snippet, and only a manager change a shared one', async () => {
    expect((await create(a.sdr, { name: 'Sneaky', bodyHtml: '<p>x</p>', isShared: true })).status).toBe(403);

    const shared = await (await create(a.director, { name: 'Case study', bodyHtml: '<p>We booked 40 meetings.</p>', isShared: true })).json();
    expect(shared.isShared).toBe(true);

    const seen = await (await call(a.sdr, () => snippetsGet(json('/api/snippets', 'GET')))).json();
    expect(seen.find((s: { id: string }) => s.id === shared.id)).toMatchObject({ canManage: false });

    expect((await call(a.sdr, () => snippetPatch(json(`/api/snippets/${shared.id}`, 'PATCH', { name: 'mine now' }), ctx(shared.id)))).status).toBe(403);
    expect((await call(a.sdr, () => snippetDelete(json(`/api/snippets/${shared.id}`, 'DELETE'), ctx(shared.id)))).status).toBe(403);
    expect((await call(a.director, () => snippetPatch(json(`/api/snippets/${shared.id}`, 'PATCH', { name: 'Case study v2' }), ctx(shared.id)))).status).toBe(200);
    expect((await call(a.director, () => snippetDelete(json(`/api/snippets/${shared.id}`, 'DELETE'), ctx(shared.id)))).status).toBe(200);
  });

  it('does not let a rep share their own snippet by editing it', async () => {
    const mine = await (await create(a.sdr, { name: 'Mine', bodyHtml: '<p>x</p>' })).json();
    expect((await call(a.sdr, () => snippetPatch(json(`/api/snippets/${mine.id}`, 'PATCH', { isShared: true }), ctx(mine.id)))).status).toBe(403);
  });

  it('is invisible across tenants, shared or not', async () => {
    const shared = await (await create(a.director, { name: 'Tenant A only', bodyHtml: '<p>x</p>', isShared: true })).json();
    const list = await (await call(b.sdr, () => snippetsGet(json('/api/snippets', 'GET')), 'b')).json();
    expect(list.map((s: { id: string }) => s.id)).not.toContain(shared.id);
    expect((await call(b.director, () => snippetPatch(json(`/api/snippets/${shared.id}`, 'PATCH', { name: 'x' }), ctx(shared.id)), 'b')).status).toBe(404);
    expect((await call(b.director, () => snippetDelete(json(`/api/snippets/${shared.id}`, 'DELETE'), ctx(shared.id)), 'b')).status).toBe(404);
  });

  it('sanitises the body, turns chips back into tags, and refuses an empty or unnamed snippet', async () => {
    const res = await create(a.sdr, {
      name: 'Opener',
      bodyHtml: '<p onclick="x()">Hi <span data-merge-tag="firstName" data-fallback="there">{{firstName|there}}</span><script>1</script></p>',
    });
    const made = await res.json();
    expect(made.bodyHtml).toBe('<p>Hi {{firstName|there}}</p>');
    expect((await create(a.sdr, { name: 'Blank', bodyHtml: '<p></p>' })).status).toBe(400);
    expect((await create(a.sdr, { name: '  ', bodyHtml: '<p>x</p>' })).status).toBe(400);
  });

  it('searches by name', async () => {
    await create(a.sdr, { name: 'Zebra pricing note', bodyHtml: '<p>x</p>' });
    const list = await (await call(a.sdr, () => snippetsGet(json('/api/snippets?search=zebra', 'GET')))).json();
    expect(list.every((s: { name: string }) => /zebra/i.test(s.name))).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});
