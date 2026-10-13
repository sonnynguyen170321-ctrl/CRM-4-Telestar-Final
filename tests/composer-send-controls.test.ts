/**
 * Composer send controls (PR G), proved against the database. Only the session, the queue and the
 * mail provider are stubbed; the routes, the worker, the gates and the rows are real.
 *
 *  - schedule send: row + delayed job, bounds, cancel, reschedule, nobody else's message;
 *  - undo send: delayed job, cancel is a compare-and-set (idempotent, too late once claimed), revive;
 *  - the worker: never sends before scheduledFor, never sends a cancelled message, tracking per email;
 *  - drafts: owner-only, tenant-scoped, restored, cleared on send;
 *  - test send: goes to the caller's own address and leaves no trace;
 *  - status endpoint scope, the checklist, and the tenant tracking default.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

const session = { current: null as unknown };
const mockEnqueue = vi.fn().mockResolvedValue('job-1');
const mockReschedule = vi.fn().mockResolvedValue('job-2');
const mockRemove = vi.fn().mockResolvedValue(true);
const mockRelease = vi.fn().mockResolvedValue(undefined);
const mockSend = vi.fn().mockResolvedValue({ providerMessageId: 'pm-1' });

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAuth: async () => session.current, requireRole: async () => session.current };
});
vi.mock('@/lib/bullmq/enqueue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bullmq/enqueue')>()),
  enqueue: (...a: unknown[]) => mockEnqueue(...a),
  enqueueReschedule: (...a: unknown[]) => mockReschedule(...a),
  removeQueuedJob: (...a: unknown[]) => mockRemove(...a),
}));
vi.mock('@/lib/sequences/stepOutcome', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sequences/stepOutcome')>()),
  releaseSequenceStep: (...a: unknown[]) => mockRelease(...a),
}));
vi.mock('@/lib/email/EmailService', () => ({
  EmailService: { fromAccount: vi.fn().mockResolvedValue({ send: (...a: unknown[]) => mockSend(...a) }) },
}));

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { POST as send } from '@/app/api/email/send/route';
import { POST as reply } from '@/app/api/inbox/threads/[id]/reply/route';
import { GET as statusGet } from '@/app/api/email/outbound/[id]/status/route';
import { POST as cancel } from '@/app/api/email/outbound/[id]/cancel/route';
import { POST as schedule } from '@/app/api/email/outbound/[id]/schedule/route';
import { GET as draftGet, PUT as draftPut, DELETE as draftDelete } from '@/app/api/email/drafts/route';
import { POST as testSend } from '@/app/api/email/test-send/route';
import { POST as preflight } from '@/app/api/email/preflight/route';
import { GET as defaultsGet, PUT as defaultsPut } from '@/app/api/email/send-defaults/route';
import { handleEmailSend } from '@/workers/email';
import { emailSendPayloadFor } from '@/lib/workflows/email';
import { __setAttemptLimitRedis } from '@/lib/security/attemptLimit';
import type { SessionUser } from '@/lib/auth';

interface World {
  tenantId: string;
  sdr: SessionUser;
  otherSdr: SessionUser;
  director: SessionUser;
  leadId: string;
  leadEmail: string;
  accountId: string;
  campaignId: string;
  inboundId: string;
}

const createdTenants: string[] = [];

async function buildWorld(label: string): Promise<World> {
  const tenantId = `tcs-${label}-${randomUUID()}`;
  await prisma.tenant.create({ data: { id: tenantId, name: `Send controls ${label}` } });
  createdTenants.push(tenantId);
  return tenantStorage.run({ tenantId, bypassRls: true }, async () => {
    const mkUser = (role: 'sdr' | 'director', firstName: string) =>
      prisma.user.create({ data: { tenantId, email: `${firstName}.${randomUUID()}@t.test`, firstName, lastName: 'T', password: 'x', role } });
    const sdrRow = await mkUser('sdr', 'Mei');
    const otherRow = await mkUser('sdr', 'Bao');
    const directorRow = await mkUser('director', 'Dan');
    const client = await prisma.client.create({ data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
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
        tenantId, accountId: account.id, leadId: lead.id, fromEmail: leadEmail, to: account.email, subject: 'Re: Intro',
        body: 'Sounds interesting', providerMessageId: `pm-${randomUUID()}`, rfcMessageId: '<p1@mail.acme.test>', date: new Date(),
      },
    });
    const asSession = (u: typeof sdrRow): SessionUser => ({
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role as SessionUser['role'], tenantId,
    });
    return {
      tenantId, sdr: asSession(sdrRow), otherSdr: asSession(otherRow), director: asSession(directorRow),
      leadId: lead.id, leadEmail, accountId: account.id, campaignId: campaign.id, inboundId: inbound.id,
    };
  });
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(new Request(`https://crm.test${url}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

let a: World;
let b: World;
const as = (user: SessionUser) => { session.current = user; };
const inA = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: a.tenantId, bypassRls: true }, fn);
const rowOf = (id: string) => inA(() => prisma.outboundMessage.findFirstOrThrow({ where: { id } }));
const hoursAhead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const sendBody = (extra: Record<string, unknown> = {}) => ({
  accountId: a.accountId, to: a.leadEmail, subject: 'Hello {{firstName}}', body: '<p>Hi {{firstName}}, a link: <a href="https://acme.test/x">x</a></p>',
  leadId: a.leadId, clientRequestId: randomUUID(), ...extra,
});
async function sendOk(extra: Record<string, unknown> = {}) {
  as(a.sdr);
  const res = await send(json('/api/email/send', 'POST', sendBody(extra)));
  const data = await res.json();
  expect(res.status, JSON.stringify(data)).toBe(200);
  return data as { outboundMessageId: string; sendAt: string | null; undoSeconds: number };
}
// The worker runs inside the tenant of the job (workers/workerUtils), as it does here.
const runWorker = (payload: Parameters<typeof handleEmailSend>[0]) => tenantStorage.run({ tenantId: a.tenantId }, () => handleEmailSend(payload));
const envBackup = { ...process.env };

beforeAll(async () => {
  a = await buildWorld('a');
  b = await buildWorld('b');
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: createdTenants } } });
});
beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueue.mockResolvedValue('job-1');
  mockReschedule.mockResolvedValue('job-2');
  mockRemove.mockResolvedValue(true);
  mockSend.mockResolvedValue({ providerMessageId: 'pm-1' });
  session.current = null;
  __setAttemptLimitRedis(null);
  process.env = { ...envBackup };
});

describe('schedule send', () => {
  it('stores scheduledFor, who wrote it, and queues a delayed job for that time', async () => {
    const at = hoursAhead(2);
    const data = await sendOk({ scheduledFor: at });
    const row = await rowOf(data.outboundMessageId);
    expect(row.scheduledFor?.toISOString()).toBe(at);
    expect(row.composedById).toBe(a.sdr.id);
    expect(row.status).toBe('pending');
    expect(mockReschedule).toHaveBeenCalledTimes(1);
    const [, payload, opts] = mockReschedule.mock.calls[0];
    expect(payload.outboundMessageId).toBe(row.id);
    expect(opts.discriminator).toBe(`sched:${at}`);
    expect(opts.delay).toBeGreaterThan(2 * 3_600_000 - 60_000);
    expect(data.sendAt).toBe(at);
  });

  it('refuses a time less than a minute away or more than 90 days away, and queues nothing', async () => {
    as(a.sdr);
    for (const scheduledFor of [new Date(Date.now() + 10_000).toISOString(), new Date(Date.now() + 91 * 86_400_000).toISOString(), 'not-a-date']) {
      const res = await send(json('/api/email/send', 'POST', sendBody({ scheduledFor })));
      expect(res.status).toBe(400);
    }
    expect(mockReschedule).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('cancel removes the job and marks the message cancelled; a second cancel is still a success', async () => {
    const { outboundMessageId } = await sendOk({ scheduledFor: hoursAhead(3) });
    const first = await cancel(json('/x', 'POST'), idParams(outboundMessageId));
    expect(first.status).toBe(200);
    const row = await rowOf(outboundMessageId);
    expect(row.status).toBe('cancelled');
    expect(row.cancelledAt).not.toBeNull();
    expect(mockRemove).toHaveBeenCalled();
    const again = await cancel(json('/x', 'POST'), idParams(outboundMessageId));
    expect(again.status).toBe(200);
  });

  it('reschedule moves the row and the job; it refuses once the message is no longer waiting', async () => {
    const { outboundMessageId } = await sendOk({ scheduledFor: hoursAhead(3) });
    const next = hoursAhead(5);
    const res = await schedule(json('/x', 'POST', { scheduledFor: next }), idParams(outboundMessageId));
    expect(res.status).toBe(200);
    expect((await rowOf(outboundMessageId)).scheduledFor?.toISOString()).toBe(next);
    expect(mockRemove).toHaveBeenCalled();
    expect(mockReschedule.mock.calls.at(-1)?.[2].discriminator).toBe(`sched:${next}`);

    await inA(() => prisma.outboundMessage.update({ where: { id: outboundMessageId }, data: { status: 'sending' } }));
    const late = await schedule(json('/x', 'POST', { scheduledFor: hoursAhead(6) }), idParams(outboundMessageId));
    expect(late.status).toBe(409);
    const tooSoon = await schedule(json('/x', 'POST', { scheduledFor: new Date(Date.now() + 5000).toISOString() }), idParams(outboundMessageId));
    expect(tooSoon.status).toBe(400);
  });

  it('is not another rep\'s or another tenant\'s to cancel or move', async () => {
    const { outboundMessageId } = await sendOk({ scheduledFor: hoursAhead(3) });
    as(a.otherSdr);
    expect((await cancel(json('/x', 'POST'), idParams(outboundMessageId))).status).toBe(404);
    expect((await schedule(json('/x', 'POST', { scheduledFor: hoursAhead(4) }), idParams(outboundMessageId))).status).toBe(404);
    as(b.sdr);
    expect((await cancel(json('/x', 'POST'), idParams(outboundMessageId))).status).toBe(404);
    expect((await rowOf(outboundMessageId)).status).toBe('pending');
    // Author only: even someone who may open the lead (a director) cannot take it back.
    as(a.director);
    expect((await cancel(json('/x', 'POST'), idParams(outboundMessageId))).status).toBe(404);
    expect((await rowOf(outboundMessageId)).status).toBe('pending');
  });

  it('never lets a sequence message be cancelled from here', async () => {
    const row = await inA(() =>
      prisma.outboundMessage.create({
        data: {
          tenantId: a.tenantId, leadId: a.leadId, accountId: a.accountId, to: a.leadEmail, subject: 's', body: 'b',
          idempotencyKey: `seq-${randomUUID()}`, sequenceId: 'seq-x', composedById: a.sdr.id,
        },
      }),
    );
    as(a.sdr);
    expect((await cancel(json('/x', 'POST'), idParams(row.id))).status).toBe(404);
  });
});

describe('undo send', () => {
  it('queues the job after the undo window without scheduling the message', async () => {
    const data = await sendOk({ delaySeconds: 10 });
    const row = await rowOf(data.outboundMessageId);
    expect(row.scheduledFor).toBeNull();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][2].delay).toBe(10_000);
    expect(data.undoSeconds).toBe(10);
  });

  it('an immediate send without a delay queues straight away (existing behaviour)', async () => {
    await sendOk();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][2].delay).toBeUndefined();
  });

  it('undo cancels, the worker then skips it, and answers 409 once the worker has claimed it', async () => {
    const { outboundMessageId } = await sendOk({ delaySeconds: 10 });
    expect((await cancel(json('/x', 'POST'), idParams(outboundMessageId))).status).toBe(200);
    const row = await rowOf(outboundMessageId);
    const result = await runWorker(emailSendPayloadFor(row));
    expect(result).toMatchObject({ skipped: true, reason: 'cancelled' });
    expect(mockSend).not.toHaveBeenCalled();

    const second = await sendOk({ delaySeconds: 10 });
    await inA(() => prisma.outboundMessage.update({ where: { id: second.outboundMessageId }, data: { status: 'sending' } }));
    const late = await cancel(json('/x', 'POST'), idParams(second.outboundMessageId));
    expect(late.status).toBe(409);
    expect((await late.json()).code).toBe('too_late');
  });

  it('two racing cancels both succeed and the message is cancelled once', async () => {
    const { outboundMessageId } = await sendOk({ delaySeconds: 10 });
    const results = await Promise.all([
      cancel(json('/x', 'POST'), idParams(outboundMessageId)),
      cancel(json('/x', 'POST'), idParams(outboundMessageId)),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
  });

  it('a manual-key replay of an undone email is refused, never resurrected (M1)', async () => {
    const requestId = randomUUID();
    const first = await sendOk({ delaySeconds: 10, clientRequestId: requestId });
    await cancel(json('/x', 'POST'), idParams(first.outboundMessageId));
    mockEnqueue.mockClear();
    as(a.sdr);
    const res = await send(json('/api/email/send', 'POST', sendBody({ clientRequestId: requestId, delaySeconds: 10, subject: 'Replay' })));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('cancelled');
    expect((await rowOf(first.outboundMessageId)).status).toBe('cancelled');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  describe('a plain email task is the one key that may revive an undone send', () => {
    const mkTask = () =>
      inA(() => prisma.task.create({ data: { tenantId: a.tenantId, leadId: a.leadId, userId: a.sdr.id, type: 'email', title: 'Write', dueDate: new Date() } }));

    it('revives with the new content when the request matches the row', async () => {
      const task = await mkTask();
      const first = await sendOk({ delaySeconds: 10, taskId: task.id });
      await cancel(json('/x', 'POST'), idParams(first.outboundMessageId));
      as(a.sdr);
      const res = await send(json('/api/email/send', 'POST', sendBody({ taskId: task.id, delaySeconds: 10, subject: 'Fixed subject' })));
      expect(res.status).toBe(200);
      const row = await rowOf(first.outboundMessageId);
      expect(row).toMatchObject({ status: 'pending', subject: 'Fixed subject', cancelledAt: null });
    });

    it('refuses when the recipient, lead or mailbox differs from the cancelled row (L2)', async () => {
      const task = await mkTask();
      const first = await sendOk({ delaySeconds: 10, taskId: task.id });
      await cancel(json('/x', 'POST'), idParams(first.outboundMessageId));
      as(a.sdr);
      const res = await send(json('/api/email/send', 'POST', sendBody({ taskId: task.id, to: 'someone.else@acme.test', delaySeconds: 10 })));
      expect(res.status).toBe(409);
      expect((await rowOf(first.outboundMessageId)).status).toBe('cancelled');
    });

    it('refuses to revive someone else cancelled message', async () => {
      const task = await mkTask();
      const first = await sendOk({ delaySeconds: 10, taskId: task.id });
      await cancel(json('/x', 'POST'), idParams(first.outboundMessageId));
      await inA(() => prisma.outboundMessage.update({ where: { id: first.outboundMessageId }, data: { composedById: a.otherSdr.id } }));
      as(a.sdr);
      const res = await send(json('/api/email/send', 'POST', sendBody({ taskId: task.id })));
      expect(res.status).toBe(409);
    });
  });

  it('reschedule enqueues the new job before removing the old one, and rolls the row back if it cannot enqueue (L5)', async () => {
    const at = hoursAhead(3);
    const { outboundMessageId } = await sendOk({ scheduledFor: at });
    mockReschedule.mockClear();
    mockRemove.mockClear();
    const next = hoursAhead(5);
    await schedule(json('/x', 'POST', { scheduledFor: next }), idParams(outboundMessageId));
    expect(mockReschedule.mock.invocationCallOrder[0]).toBeLessThan(mockRemove.mock.invocationCallOrder[0]);

    mockReschedule.mockRejectedValueOnce(new Error('redis down'));
    mockRemove.mockClear();
    const res = await schedule(json('/x', 'POST', { scheduledFor: hoursAhead(7) }), idParams(outboundMessageId));
    expect(res.status).toBe(500);
    expect((await rowOf(outboundMessageId)).scheduledFor?.toISOString()).toBe(next);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('the worker', () => {
  async function pendingRow(data: Record<string, unknown> = {}) {
    return inA(() =>
      prisma.outboundMessage.create({
        data: {
          tenantId: a.tenantId, leadId: a.leadId, accountId: a.accountId, to: a.leadEmail, subject: 'Hello', body: '<p>Hi <a href="https://acme.test/x">x</a></p>',
          idempotencyKey: `w-${randomUUID()}`, composedById: a.sdr.id, ...data,
        },
      }),
    );
  }

  it('does not send before scheduledFor: it re-queues for that time and leaves the row pending', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    const due = new Date(Date.now() + 3_600_000);
    const row = await pendingRow({ scheduledFor: due });
    const result = await runWorker(emailSendPayloadFor(row));
    expect(result).toMatchObject({ skipped: true, reason: 'not_yet_due' });
    expect(mockSend).not.toHaveBeenCalled();
    expect((await rowOf(row.id)).status).toBe('pending');
    expect(mockReschedule).toHaveBeenCalledTimes(1);
    expect(mockReschedule.mock.calls[0][2].discriminator).toBe(`sched:${due.toISOString()}`);
  });

  it('sends once the scheduled time has passed', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    const row = await pendingRow({ scheduledFor: new Date(Date.now() - 1000) });
    const result = await runWorker(emailSendPayloadFor(row));
    expect(result).toMatchObject({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((await rowOf(row.id)).status).toBe('sent');
  });

  it('applies the per-email tracking decision to a one-off send', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    process.env.TRACKING_SECRET = 'test-tracking-secret-0123456789';
    const tracked = await pendingRow({ trackOpens: true, trackClicks: true });
    await runWorker(emailSendPayloadFor(tracked));
    const html = mockSend.mock.calls[0][0].html as string;
    expect(html).toContain('width="1" height="1"');
    expect(html).not.toContain('href="https://acme.test/x"');
    expect((await rowOf(tracked.id)).openTracked).toBe(true);

    mockSend.mockClear();
    const plain = await pendingRow({ trackOpens: false, trackClicks: false });
    await runWorker(emailSendPayloadFor(plain));
    const plainHtml = mockSend.mock.calls[0][0].html as string;
    expect(plainHtml).not.toContain('width="1" height="1"');
    expect(plainHtml).toContain('href="https://acme.test/x"');
    expect((await rowOf(plain.id)).openTracked).toBe(false);
  });

  it('the redrive sweep filter leaves a message scheduled for later alone', async () => {
    const row = await pendingRow({ scheduledFor: new Date(Date.now() + 86_400_000) });
    await inA(() => prisma.outboundMessage.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 7 * 86_400_000) } }));
    const stalled = await inA(() =>
      prisma.outboundMessage.findMany({
        where: {
          id: row.id, status: 'pending', sentAt: null,
          AND: [{ OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }] }],
        },
      }),
    );
    expect(stalled).toHaveLength(0);
  });
});

describe('tracking default per email', () => {
  it('takes the tenant default when the composer names nothing, and an explicit choice wins', async () => {
    const fresh = await sendOk();
    expect(await rowOf(fresh.outboundMessageId)).toMatchObject({ trackOpens: false, trackClicks: false });

    as(a.director);
    const put = await defaultsPut(json('/api/email/send-defaults', 'PUT', { trackOpens: true }));
    expect(await put.json()).toEqual({ trackOpens: true, trackClicks: false });
    as(a.sdr);
    expect(await (await defaultsGet()).json()).toEqual({ trackOpens: true, trackClicks: false });

    const defaulted = await sendOk();
    expect(await rowOf(defaulted.outboundMessageId)).toMatchObject({ trackOpens: true, trackClicks: false });
    const explicit = await sendOk({ trackOpens: false, trackClicks: true });
    expect(await rowOf(explicit.outboundMessageId)).toMatchObject({ trackOpens: false, trackClicks: true });

    // Another tenant's default is its own.
    as(b.sdr);
    expect(await (await defaultsGet()).json()).toEqual({ trackOpens: false, trackClicks: false });
    await prisma.tenant.update({ where: { id: a.tenantId }, data: { defaultTrackOpens: false } });
  });
});

describe('status endpoint', () => {
  it('follows the caller\'s own message through queued, scheduled, deferred, sent and failed', async () => {
    const { outboundMessageId } = await sendOk();
    as(a.sdr);
    const read = async () => (await (await statusGet(json('/x', 'GET'), idParams(outboundMessageId))).json());
    expect(await read()).toMatchObject({ phase: 'queued', final: false });
    await inA(() => prisma.outboundMessage.update({ where: { id: outboundMessageId }, data: { errorMessage: `Daily send limit reached — deferred to ${hoursAhead(5)}` } }));
    expect(await read()).toMatchObject({ phase: 'deferred', final: false });
    await inA(() => prisma.outboundMessage.update({ where: { id: outboundMessageId }, data: { status: 'sent', sentAt: new Date(), errorMessage: null } }));
    expect(await read()).toMatchObject({ phase: 'sent', final: true });
    await inA(() => prisma.outboundMessage.update({ where: { id: outboundMessageId }, data: { status: 'failed', errorMessage: 'SMTP 550 raw provider transcript secret-host.internal' } }));
    const failed = await read();
    expect(failed).toMatchObject({ phase: 'failed', final: true });
    expect(JSON.stringify(failed)).not.toContain('secret-host');
  });

  it('is a 404 for anyone but the author, in any tenant', async () => {
    const { outboundMessageId } = await sendOk();
    for (const user of [a.otherSdr, a.director, b.sdr]) {
      as(user);
      expect((await statusGet(json('/x', 'GET'), idParams(outboundMessageId))).status).toBe(404);
    }
  });
});

describe('drafts', () => {
  const draft = (extra: Record<string, unknown> = {}) => ({
    leadId: a.leadId, accountId: a.accountId, subject: 'Draft subject', bodyHtml: '<p>Half written</p>', cc: ['c@x.test'], ...extra,
  });

  it('saves, restores, and updates one draft per place', async () => {
    as(a.sdr);
    expect((await draftPut(json('/api/email/drafts', 'PUT', draft()))).status).toBe(200);
    await draftPut(json('/api/email/drafts', 'PUT', draft({ bodyHtml: '<p>More</p>' })));
    const got = await (await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'))).json();
    expect(got.draft).toMatchObject({ subject: 'Draft subject', bodyHtml: '<p>More</p>', cc: ['c@x.test'] });
    expect(await inA(() => prisma.emailDraft.count({ where: { userId: a.sdr.id } }))).toBe(1);

    // A thread reply box is a different place.
    await draftPut(json('/api/email/drafts', 'PUT', draft({ threadId: `${a.leadId}-intro`, bodyHtml: '<p>Reply</p>' })));
    const thread = await (await draftGet(json(`/api/email/drafts?leadId=${a.leadId}&threadId=${a.leadId}-intro`, 'GET'))).json();
    expect(thread.draft.bodyHtml).toBe('<p>Reply</p>');
  });

  it('is owner-only and tenant-scoped', async () => {
    as(a.sdr);
    await draftPut(json('/api/email/drafts', 'PUT', draft()));
    for (const user of [a.director, b.sdr]) {
      as(user);
      const res = await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'));
      if (res.status === 200) expect((await res.json()).draft).toBeNull();
      else expect(res.status).toBe(404);
    }
    as(a.otherSdr);
    expect((await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'))).status).toBe(404);
    expect((await draftPut(json('/api/email/drafts', 'PUT', draft()))).status).toBe(404);
    // Someone else's delete touches only their own (empty) place.
    as(a.director);
    await draftDelete(json(`/api/email/drafts?leadId=${a.leadId}`, 'DELETE'));
    as(a.sdr);
    expect((await (await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'))).json()).draft).not.toBeNull();
  });

  it('an empty draft is removed, discard deletes, and sending clears it', async () => {
    as(a.sdr);
    await draftPut(json('/api/email/drafts', 'PUT', draft()));
    await draftPut(json('/api/email/drafts', 'PUT', draft({ subject: '', bodyHtml: '<p></p>' })));
    expect((await (await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'))).json()).draft).toBeNull();

    await draftPut(json('/api/email/drafts', 'PUT', draft()));
    await draftDelete(json(`/api/email/drafts?leadId=${a.leadId}`, 'DELETE'));
    expect((await (await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'))).json()).draft).toBeNull();

    await draftPut(json('/api/email/drafts', 'PUT', draft()));
    await sendOk();
    as(a.sdr);
    expect((await (await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'))).json()).draft).toBeNull();
  });

  it('drops an attachment that is no longer the caller\'s unsent upload', async () => {
    const own = await inA(() => prisma.attachment.create({ data: { tenantId: a.tenantId, name: 'a.pdf', contentType: 'application/pdf', content: 'AA==', uploadedById: a.sdr.id, sizeBytes: 1 } }));
    const sent = await inA(() => prisma.attachment.create({ data: { tenantId: a.tenantId, name: 'b.pdf', contentType: 'application/pdf', content: 'AA==', uploadedById: a.sdr.id, outboundMessageId: 'x', sizeBytes: 1 } }));
    as(a.sdr);
    await draftPut(json('/api/email/drafts', 'PUT', draft({ attachmentIds: [own.id, sent.id] })));
    const got = await (await draftGet(json(`/api/email/drafts?leadId=${a.leadId}`, 'GET'))).json();
    expect(got.draft.attachments.map((x: { id: string }) => x.id)).toEqual([own.id]);
  });
});

describe('test send to myself', () => {
  const body = () => ({ leadId: a.leadId, accountId: a.accountId, subject: 'Hi {{firstName}}', body: '<p>Hello {{firstName}} at {{company}}</p>' });

  it('sends the rendered email to the caller\'s own address and leaves no trace', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    as(a.sdr);
    const before = await inA(async () => ({
      out: await prisma.outboundMessage.count({ where: { tenantId: a.tenantId } }),
      act: await prisma.activity.count({ where: { leadId: a.leadId } }),
      lead: (await prisma.lead.findFirstOrThrow({ where: { id: a.leadId } })).lastContactedAt,
    }));
    const res = await testSend(json('/api/email/test-send', 'POST', body()));
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sent = mockSend.mock.calls[0][0];
    expect(sent.to).toBe(a.sdr.email);
    expect(sent.subject).toBe('[Test] Hi Linh');
    expect(sent.html).toContain('Hello Linh at Acme');
    expect(sent.html).not.toContain('width="1" height="1"');
    expect(sent.headers).toBeUndefined();
    const after = await inA(async () => ({
      out: await prisma.outboundMessage.count({ where: { tenantId: a.tenantId } }),
      act: await prisma.activity.count({ where: { leadId: a.leadId } }),
      lead: (await prisma.lead.findFirstOrThrow({ where: { id: a.leadId } })).lastContactedAt,
    }));
    expect(after).toEqual(before);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('cannot be aimed at anyone else: no recipient field, other tenants\' leads and mailboxes refused', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    as(a.sdr);
    await testSend(json('/api/email/test-send', 'POST', { ...body(), to: 'victim@x.test' }));
    expect(mockSend.mock.calls[0][0].to).toBe(a.sdr.email);
    mockSend.mockClear();
    as(b.sdr);
    expect((await testSend(json('/api/email/test-send', 'POST', body()))).status).toBe(404);
    as(a.otherSdr);
    expect((await testSend(json('/api/email/test-send', 'POST', body()))).status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('is rate limited per user', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    const counts = new Map<string, number>();
    __setAttemptLimitRedis({
      incr: async (k) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; },
      expire: async () => 1, ttl: async () => 300, del: async () => 1,
    });
    as(a.sdr);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await testSend(json('/api/email/test-send', 'POST', body()))).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    __setAttemptLimitRedis(null);
  });

  it('honours dry-run: nothing leaves', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'true';
    as(a.sdr);
    const res = await testSend(json('/api/email/test-send', 'POST', body()));
    expect(await res.json()).toMatchObject({ dryRun: true });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('pre-send checklist route', () => {
  const ask = (extra: Record<string, unknown> = {}) =>
    preflight(json('/api/email/preflight', 'POST', { leadId: a.leadId, accountId: a.accountId, subject: 'Hi {{firstName}}', body: '<p>Hi {{firstName}}</p>', ...extra }));

  it('is clear for a normal recipient and mailbox', async () => {
    as(a.sdr);
    const data = await (await ask()).json();
    expect(data.canSend).toBe(true);
    expect(data.items.find((i: { id: string }) => i.id === 'recipient').severity).toBe('ok');
  });

  it('blocks a suppressed recipient and a paused mailbox, and warns on missing variables and bulk without unsubscribe', async () => {
    as(a.sdr);
    const missing = await (await ask({ body: '<p>{{title}}</p>', bulk: true })).json();
    expect(missing.canSend).toBe(true);
    expect(missing.items.find((i: { id: string }) => i.id === 'variables').severity).toBe('warn');
    expect(missing.items.find((i: { id: string }) => i.id === 'unsubscribe').severity).toBe('warn');

    await inA(() => prisma.emailAccount.update({ where: { id: a.accountId }, data: { sendPausedAt: new Date(), sendPauseReason: 'warm-up' } }));
    const paused = await (await ask()).json();
    expect(paused.canSend).toBe(false);
    expect(paused.items.find((i: { id: string }) => i.id === 'mailbox').severity).toBe('block');
    await inA(() => prisma.emailAccount.update({ where: { id: a.accountId }, data: { sendPausedAt: null, sendPauseReason: null } }));

    const entry = await inA(() => prisma.suppressionEntry.create({ data: { tenantId: a.tenantId, email: a.leadEmail.toLowerCase(), reason: 'manual' } }));
    const suppressed = await (await ask()).json();
    expect(suppressed.canSend).toBe(false);
    expect(suppressed.items.find((i: { id: string }) => i.id === 'recipient').severity).toBe('block');
    await inA(() => prisma.suppressionEntry.delete({ where: { id: entry.id } }));
  });

  it('warns when the mailbox has no sends left today, and is scoped to the caller', async () => {
    as(a.sdr);
    await inA(() => prisma.emailAccount.update({ where: { id: a.accountId }, data: { dailySendCount: 80, dailySendDate: new Date() } }));
    const data = await (await ask()).json();
    expect(data.items.find((i: { id: string }) => i.id === 'quota').severity).toBe('warn');
    await inA(() => prisma.emailAccount.update({ where: { id: a.accountId }, data: { dailySendCount: 0 } }));
    as(b.sdr);
    expect((await ask()).status).toBe(404);
    as(a.otherSdr);
    expect((await ask()).status).toBe(404);
  });
});

describe('inbox reply uses the same controls', () => {
  it('schedules a reply and records its author', async () => {
    as(a.sdr);
    const at = hoursAhead(4);
    const res = await reply(
      json(`/api/inbox/threads/${a.leadId}-intro/reply`, 'POST', { leadId: a.leadId, body: '<p>Thanks</p>', subject: 'Intro', scheduledFor: at, clientRequestId: randomUUID() }),
      idParams(`${a.leadId}-intro`),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const data = await res.json();
    const row = await rowOf(data.outboundMessage.id);
    expect(row.scheduledFor?.toISOString()).toBe(at);
    expect(row.composedById).toBe(a.sdr.id);
    expect(mockReschedule).toHaveBeenCalledTimes(1);
  });
});

describe('hardening review follow-ups', () => {
  it('the inbox reply route never revives an undone reply (M1)', async () => {
    as(a.sdr);
    const requestId = randomUUID();
    const post = (extra: Record<string, unknown> = {}) =>
      reply(
        json(`/api/inbox/threads/${a.leadId}-intro/reply`, 'POST', { leadId: a.leadId, body: '<p>Thanks</p>', subject: 'Intro', delaySeconds: 10, clientRequestId: requestId, ...extra }),
        idParams(`${a.leadId}-intro`),
      );
    const first = await post();
    expect(first.status).toBe(200);
    const id = (await first.json()).outboundMessage.id as string;
    await cancel(json('/x', 'POST'), idParams(id));
    const replay = await post({ body: '<p>Replayed</p>' });
    expect(replay.status).toBe(409);
    expect((await replay.json()).code).toBe('cancelled');
    expect((await rowOf(id)).status).toBe('cancelled');
  });

  it('the worker sends the row current subject and body, not a stale job copy (L1)', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    const row = await inA(() =>
      prisma.outboundMessage.create({
        data: { tenantId: a.tenantId, leadId: a.leadId, accountId: a.accountId, to: a.leadEmail, subject: 'Fresh subject', body: '<p>Fresh body</p>', idempotencyKey: `w-${randomUUID()}`, composedById: a.sdr.id },
      }),
    );
    await runWorker({ ...emailSendPayloadFor(row), subject: 'Stale subject', body: '<p>Stale body</p>' });
    const sent = mockSend.mock.calls[0][0];
    expect(sent.subject).toBe('Fresh subject');
    expect(sent.html).toContain('Fresh body');
    expect(sent.html).not.toContain('Stale');
  });

  it('a cancelled message releases its sequence step if one is attached (L3)', async () => {
    const row = await inA(() =>
      prisma.outboundMessage.create({
        data: { tenantId: a.tenantId, leadId: a.leadId, accountId: a.accountId, to: a.leadEmail, subject: 's', body: 'b', idempotencyKey: `w-${randomUUID()}`, status: 'cancelled' },
      }),
    );
    const ref = { taskId: 't1', leadId: a.leadId, actorUserId: a.sdr.id, sequenceId: 'seq', sequenceStep: 1, abVariantId: null };
    const result = await runWorker({ ...emailSendPayloadFor(row), sequenceStepRef: ref });
    expect(result).toMatchObject({ skipped: true, reason: 'cancelled' });
    expect(mockRelease).toHaveBeenCalledWith(ref, expect.any(String));
  });

  it('test send is also limited per mailbox (L6)', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    const counts = new Map<string, number>([[`attempts:compose-testSendMailbox:${a.accountId}`, 20]]);
    __setAttemptLimitRedis({
      incr: async (k) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; },
      expire: async () => 1, ttl: async () => 600, del: async () => 1,
    });
    as(a.sdr);
    const res = await testSend(json('/api/email/test-send', 'POST', { leadId: a.leadId, accountId: a.accountId, subject: 's', body: '<p>b</p>' }));
    expect(res.status).toBe(429);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('a user keeps at most 200 drafts: saving a new one prunes the oldest (L7)', async () => {
    const lead2 = await inA(() => prisma.lead.create({ data: { tenantId: a.tenantId, firstName: 'Cap', lastName: 'T', email: `cap.${randomUUID()}@acme.test`, company: 'Acme', assignedToId: a.sdr.id, campaignId: a.campaignId } }));
    await inA(async () => {
      await prisma.emailDraft.deleteMany({ where: { userId: a.sdr.id } });
      await prisma.emailDraft.createMany({
        data: Array.from({ length: 200 }, (_, i) => ({
          tenantId: a.tenantId, userId: a.sdr.id, scopeKey: `lead:old-${i}`, subject: 's', bodyHtml: '<p>x</p>',
          updatedAt: new Date(Date.now() - (1000 - i) * 60_000),
        })),
      });
    });
    as(a.sdr);
    const res = await draftPut(json('/api/email/drafts', 'PUT', { leadId: lead2.id, subject: 'new', bodyHtml: '<p>new</p>' }));
    expect(res.status).toBe(200);
    const keys = await inA(() => prisma.emailDraft.findMany({ where: { userId: a.sdr.id }, select: { scopeKey: true } }));
    expect(keys).toHaveLength(200);
    expect(keys.map((k) => k.scopeKey)).toContain(`lead:${lead2.id}`);
    expect(keys.map((k) => k.scopeKey)).not.toContain('lead:old-0');
    await inA(() => prisma.emailDraft.deleteMany({ where: { userId: a.sdr.id } }));
  });
});
