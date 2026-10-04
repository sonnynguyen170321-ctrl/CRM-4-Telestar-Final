import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

process.env.TRACKING_SECRET = process.env.TRACKING_SECRET || 'test-tracking-secret';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clickSignature,
  isSuspectedMachine,
  trackingConfigured,
  openPixelHtml,
  rewriteLinksForTracking,
  trackingToken,
  verifyClick,
  verifyTrackingToken,
} from '@/lib/email/tracking';
import { MAX_EVENTS_PER_MESSAGE, recordTrackingEvent } from '@/lib/email/trackingEvents';
import { prisma, tenantStorage } from '@/lib/prisma';
import { GET as pixel } from '@/app/api/t/o/[token]/route';
import { GET as click } from '@/app/api/t/c/[token]/route';
import { createTestTenant } from './helpers/testTenant';

/**
 * Open and click tracking (owner request: open and click rates per sequence).
 *
 * The routes are public — a prospect's mail client has no session — so what matters most is what
 * they refuse: a token the CRM did not sign, a click destination it did not put in that email, and
 * machine hits counted as people.
 */

const BASE = 'https://crm.telestar.cloud';

describe('signed tokens', () => {
  it('round-trips the tenant and the message', () => {
    expect(verifyTrackingToken(trackingToken('tenant-a', 'msg-1'))).toEqual({ tenantId: 'tenant-a', messageId: 'msg-1' });
  });

  it('refuses a token whose tenant or message was changed', () => {
    const token = trackingToken('tenant-a', 'msg-1');
    const [, sig] = token.split('.');
    const forged = `${Buffer.from('tenant-b.msg-1').toString('base64url')}.${sig}`;
    expect(verifyTrackingToken(forged)).toBeNull();
    expect(verifyTrackingToken('garbage')).toBeNull();
  });

  it('binds a click to the exact URL it was signed for — no open redirect', () => {
    const token = trackingToken('tenant-a', 'msg-1');
    const sig = clickSignature(token, 'https://telestar.cloud/case-study');
    expect(verifyClick(token, 'https://telestar.cloud/case-study', sig)).not.toBeNull();
    expect(verifyClick(token, 'https://evil.test/phish', sig)).toBeNull();
    expect(verifyClick(trackingToken('tenant-a', 'msg-2'), 'https://telestar.cloud/case-study', sig)).toBeNull();
  });
});

describe('what goes into the email', () => {
  it('wraps web links and leaves unsubscribe, mailto and anchors alone', () => {
    const html =
      '<p><a href="https://telestar.cloud/demo?a=1&amp;b=2">Demo</a> ' +
      '<a href="https://crm.telestar.cloud/api/unsubscribe?t=x">Unsubscribe</a> ' +
      '<a href="mailto:judy@telestar.cloud">Mail</a> <a href="#top">Top</a></p>';

    const out = rewriteLinksForTracking(html, BASE, 'tenant-a', 'msg-1');

    expect(out).toContain(`${BASE}/api/t/c/`);
    expect(out).toContain(encodeURIComponent('https://telestar.cloud/demo?a=1&b=2'));
    expect(out).toContain('href="https://crm.telestar.cloud/api/unsubscribe?t=x"');
    expect(out).toContain('href="mailto:judy@telestar.cloud"');
    expect(out).toContain('href="#top"');
  });

  it('builds a 1x1 pixel that points at a signed token', () => {
    const img = openPixelHtml(BASE, 'tenant-a', 'msg-1');
    const token = /\/api\/t\/o\/([^"]+)"/.exec(img)?.[1] ?? '';
    expect(verifyTrackingToken(token)).toEqual({ tenantId: 'tenant-a', messageId: 'msg-1' });
    expect(img).toMatch(/width="1" height="1"/);
  });
});

describe('link rewriting edge cases (code review, 2026-10-04)', () => {
  it('handles single quotes and an uppercase HREF, and leaves javascript: alone', () => {
    const out = rewriteLinksForTracking(
      "<a HREF='https://telestar.cloud/a'>A</a><a href=\"javascript:alert(1)\">x</a>",
      BASE,
      'tenant-a',
      'msg-1'
    );
    expect(out).toContain(`'${BASE}/api/t/c/`);
    expect(out).toContain('href="javascript:alert(1)"');
  });

  it('cannot be broken out of by a quote inside the original URL', () => {
    const out = rewriteLinksForTracking(`<a href="https://telestar.cloud/a?q='x'">A</a>`, BASE, 'tenant-a', 'msg-1');
    // The tracked href is built only from fixed parts and encodeURIComponent: no raw quote survives.
    const href = /href="([^"]*)"/.exec(out)?.[1] ?? '';
    expect(href.startsWith(`${BASE}/api/t/c/`)).toBe(true);
    expect(href).not.toContain("'");
  });

  it('produces the same link with or without a trailing slash on the base URL', () => {
    expect(openPixelHtml(`${BASE}/`, 'tenant-a', 'msg-1')).toBe(openPixelHtml(BASE, 'tenant-a', 'msg-1'));
    expect(openPixelHtml(`${BASE}/`, 'tenant-a', 'msg-1')).not.toContain('//api/t/');
  });
});

describe('the public paths, and only those', () => {
  const matcher = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8').match(/'\/\(\(\?!([^)]*)\)\.\*\)'/)?.[1] ?? '';
  const exempt = (path: string) => new RegExp(`^/(?!${matcher}).*`).test(path) === false;

  it('exempts the tracking routes from the staff-session proxy', () => {
    expect(matcher).toContain('api/t/');
    expect(exempt('/api/t/o/abc')).toBe(true);
    expect(exempt('/api/t/c/abc')).toBe(true);
  });

  it('keeps /api/tasks and /api/templates behind the session', () => {
    expect(exempt('/api/tasks')).toBe(false);
    expect(exempt('/api/templates/1')).toBe(false);
  });
});

describe('machine traffic', () => {
  const sentAt = new Date('2026-10-04T10:00:00Z');

  it('flags a scanner by its agent and a hit inside the machine window', () => {
    expect(isSuspectedMachine({ type: 'click', userAgent: 'Mimecast-URL-Protect/1.0', sentAt, now: new Date('2026-10-04T12:00:00Z') })).toBe(true);
    expect(isSuspectedMachine({ type: 'click', userAgent: 'Mozilla/5.0', sentAt, now: new Date('2026-10-04T10:00:04Z') })).toBe(true);
    expect(isSuspectedMachine({ type: 'open', userAgent: 'Mozilla/5.0', sentAt, now: new Date('2026-10-04T10:00:01Z') })).toBe(true);
  });

  it('treats a hit before the send was confirmed as a machine — nobody can have read it yet', () => {
    expect(isSuspectedMachine({ type: 'open', userAgent: 'Mozilla/5.0', sentAt: null })).toBe(true);
  });

  it('reports whether this process can sign tracking links', () => {
    const saved = { t: process.env.TRACKING_SECRET, a: process.env.AUTH_SECRET, n: process.env.NEXTAUTH_SECRET };
    delete process.env.TRACKING_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(trackingConfigured()).toBe(false);
    } finally {
      if (saved.t) process.env.TRACKING_SECRET = saved.t;
      if (saved.a) process.env.AUTH_SECRET = saved.a;
      if (saved.n) process.env.NEXTAUTH_SECRET = saved.n;
    }
    expect(trackingConfigured()).toBe(true);
  });

  it('counts an ordinary person later on', () => {
    expect(isSuspectedMachine({ type: 'click', userAgent: 'Mozilla/5.0 (Macintosh)', sentAt, now: new Date('2026-10-04T10:05:00Z') })).toBe(false);
  });
});

describe('recording, against the database', () => {
  let tenantId: string;
  let otherTenantId: string;
  let messageId: string;
  const sentAt = new Date('2026-10-04T10:00:00Z');
  const inTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

  beforeEach(async () => {
    tenantId = `t-track-${randomUUID()}`;
    otherTenantId = `t-track-other-${randomUUID()}`;
    await createTestTenant(tenantId, 'Tracking');
    await createTestTenant(otherTenantId, 'Tracking other');
    messageId = await inTenant(async () => {
      const user = await prisma.user.create({
        data: { tenantId, email: `u.${randomUUID()}@t.test`, firstName: 'J', lastName: 'N', password: 'x', role: 'sdr' },
      });
      const client = await prisma.client.create({
        data: { tenantId, name: 'C', industry: 'SaaS', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
      });
      const campaign = await prisma.campaign.create({ data: { tenantId, clientId: client.id, name: 'Out', startDate: new Date() } });
      const lead = await prisma.lead.create({
        data: { tenantId, firstName: 'A', lastName: 'L', email: `a.${randomUUID()}@acme.test`, company: 'Acme', assignedToId: user.id, campaignId: campaign.id },
      });
      const account = await prisma.emailAccount.create({
        data: { tenantId, userId: user.id, email: `box.${randomUUID()}@t.test`, provider: 'imap_smtp', isActive: true },
      });
      const message = await prisma.outboundMessage.create({
        data: { tenantId, leadId: lead.id, accountId: account.id, to: lead.email!, idempotencyKey: `k-${randomUUID()}`, status: 'sent', sentAt },
      });
      return message.id;
    });
  });

  const read = () => inTenant(() => prisma.outboundMessage.findUniqueOrThrow({ where: { id: messageId } }));

  it('records an open once for the timestamp and every time for the count', async () => {
    const token = { tenantId, messageId };
    await recordTrackingEvent({ token, type: 'open', userAgent: 'Mozilla/5.0', now: new Date('2026-10-04T11:00:00Z') });
    await recordTrackingEvent({ token, type: 'open', userAgent: 'Mozilla/5.0', now: new Date('2026-10-04T12:00:00Z') });

    const row = await read();
    expect(row.openCount).toBe(2);
    expect(row.openedAt?.toISOString()).toBe('2026-10-04T11:00:00.000Z');
  });

  it('does not count a repeat open within a minute — image proxies refetch', async () => {
    const token = { tenantId, messageId };
    await recordTrackingEvent({ token, type: 'open', userAgent: 'Mozilla/5.0', now: new Date('2026-10-04T11:00:00Z') });
    await recordTrackingEvent({ token, type: 'open', userAgent: 'Mozilla/5.0', now: new Date('2026-10-04T11:00:30Z') });
    expect((await read()).openCount).toBe(1);
  });

  it('stops storing events for a message past the cap — a replayed token cannot grow the table forever', async () => {
    await inTenant(() =>
      prisma.emailEvent.createMany({
        data: Array.from({ length: MAX_EVENTS_PER_MESSAGE }, () => ({
          tenantId,
          outboundMessageId: messageId,
          type: 'open',
          suspectedBot: true,
        })),
      })
    );
    await recordTrackingEvent({ token: { tenantId, messageId }, type: 'open', userAgent: 'Mozilla/5.0', now: new Date('2026-10-04T15:00:00Z') });
    expect(await inTenant(() => prisma.emailEvent.count({ where: { outboundMessageId: messageId } }))).toBe(MAX_EVENTS_PER_MESSAGE);
  });

  it('stores a machine open and does not count it', async () => {
    const outcome = await recordTrackingEvent({
      token: { tenantId, messageId },
      type: 'open',
      userAgent: 'Mozilla/5.0',
      now: new Date('2026-10-04T10:00:01Z'),
    });

    expect(outcome).toBe('recorded_as_machine');
    const row = await read();
    expect(row.openCount).toBe(0);
    expect(row.openedAt).toBeNull();
    expect(await inTenant(() => prisma.emailEvent.count({ where: { outboundMessageId: messageId, suspectedBot: true } }))).toBe(1);
  });

  it('counts a click, and the click as the first open when the pixel was blocked', async () => {
    await recordTrackingEvent({
      token: { tenantId, messageId },
      type: 'click',
      url: 'https://telestar.cloud/demo',
      userAgent: 'Mozilla/5.0',
      now: new Date('2026-10-04T11:00:00Z'),
    });

    const row = await read();
    expect(row.clickCount).toBe(1);
    expect(row.clickedAt).not.toBeNull();
    expect(row.openedAt).not.toBeNull();
  });

  it('records nothing for a token naming another tenant', async () => {
    const outcome = await recordTrackingEvent({
      token: { tenantId: otherTenantId, messageId },
      type: 'open',
      userAgent: 'Mozilla/5.0',
      now: new Date('2026-10-04T11:00:00Z'),
    });
    expect(outcome).toBe('unknown_message');
    expect((await read()).openCount).toBe(0);
  });

  it('the pixel route always answers with an image, and records only a valid token', async () => {
    const bad = await pixel(new NextRequest(`${BASE}/api/t/o/forged.token`), { params: Promise.resolve({ token: 'forged.token' }) });
    expect(bad.status).toBe(200);
    expect(bad.headers.get('content-type')).toBe('image/gif');

    const token = trackingToken(tenantId, messageId);
    await pixel(new NextRequest(`${BASE}/api/t/o/${token}`, { headers: { 'user-agent': 'Mozilla/5.0' } }), {
      params: Promise.resolve({ token }),
    });
    expect((await read()).openCount).toBe(1);
  });

  it('the click route redirects only to the signed URL', async () => {
    const token = trackingToken(tenantId, messageId);
    const target = 'https://telestar.cloud/case-study';
    const sig = clickSignature(token, target);

    const ok = await click(
      new NextRequest(`${BASE}/api/t/c/${token}?u=${encodeURIComponent(target)}&s=${sig}`, { headers: { 'user-agent': 'Mozilla/5.0' } }),
      { params: Promise.resolve({ token }) }
    );
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe(target);

    const evil = await click(
      new NextRequest(`${BASE}/api/t/c/${token}?u=${encodeURIComponent('https://evil.test')}&s=${sig}`),
      { params: Promise.resolve({ token }) }
    );
    expect(evil.status).toBe(400);
    expect(evil.headers.get('location')).toBeNull();
  });
});
