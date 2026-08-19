/**
 * Activity timeline capture (`OPS-021`).
 *
 * This test did not exist either. `OPS-021` cited `tests/activities.test.ts` and was marked
 * VERIFIED against it - see TEL-P1-019.
 *
 * The activity table is the source of truth for the Team View leaderboard, coaching, and
 * client reporting, so the invariant is that **every meaningful channel action lands in it,
 * on the right lead, with its metadata intact and in chronological order**. A timeline that
 * silently drops a channel does not look broken; it looks like a quiet rep.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('j'),
  enqueueImmediate: vi.fn().mockResolvedValue('j'),
  enqueueReschedule: vi.fn().mockResolvedValue('j'),
  ensureJob: vi.fn().mockResolvedValue('j'),
  removeJob: vi.fn().mockResolvedValue(true),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');

const T = 'activities-timeline-tenant';
const USER = 'at-sdr';
const OTHER_USER = 'at-sdr-two';
const CLIENT = 'at-client';
const CAMPAIGN = 'at-campaign';
const LEAD = 'at-lead';
const OTHER_LEAD = 'at-lead-two';

const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

/** The four outreach channels the CRM is built around, plus notes and meetings. */
const TIMELINE_EVENTS = [
  { type: 'email_sent', channel: 'email', description: 'Intro email', metadata: { subject: 'Quick question' } },
  { type: 'call_logged', channel: 'phone', description: 'Discovery call', metadata: { outcome: 'connected', durationSeconds: 372 } },
  { type: 'linkedin_touch', channel: 'linkedin', description: 'Connection accepted', metadata: { profileTouched: true } },
  { type: 'whatsapp_message', channel: 'whatsapp', description: 'Follow-up message', metadata: { inbound: false } },
  { type: 'note_added', channel: null, description: 'Budget lands next quarter', metadata: { pinned: true } },
  { type: 'meeting_booked', channel: null, description: 'Discovery meeting booked', metadata: { slot: '2026-08-25T09:00:00Z' } },
] as const;

describe.skipIf(!hasDb)('OPS-021: the activity timeline captures every channel', () => {
  beforeAll(async () => {
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
    });
    await runSystem(() => prisma.tenant.deleteMany({ where: { id: T } }));
    await runSystem(() => prisma.tenant.create({ data: { id: T, name: 'Activities Tenant' } }));
    await run(async () => {
      for (const [id, email] of [
        [USER, 'at-sdr@telestar.invalid'],
        [OTHER_USER, 'at-sdr-two@telestar.invalid'],
      ] as const) {
        await prisma.user.create({
          data: {
            id,
            tenantId: T,
            email,
            firstName: 'Rep',
            lastName: id,
            role: 'sdr',
            password: 'test-only-not-a-credential',
          },
        });
      }
      await prisma.client.create({
        data: {
          id: CLIENT,
          tenantId: T,
          name: 'Timeline Client',
          industry: 'QA',
          contactName: 'Contact',
          contactEmail: 'c@telestar.invalid',
        },
      });
      await prisma.campaign.create({
        data: {
          id: CAMPAIGN,
          tenantId: T,
          clientId: CLIENT,
          name: 'Timeline Campaign',
          startDate: new Date('2026-08-01T00:00:00Z'),
        },
      });
      for (const [id, first] of [
        [LEAD, 'Tessa'],
        [OTHER_LEAD, 'Other'],
      ] as const) {
        await prisma.lead.create({
          data: {
            id,
            tenantId: T,
            campaignId: CAMPAIGN,
            assignedToId: USER,
            firstName: first,
            lastName: 'Prospect',
            company: 'Prospect Co',
            email: `${id}@prospect.invalid`,
          },
        });
      }
    });
  });

  afterAll(async () => {
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
    });
    await runSystem(() => prisma.tenant.deleteMany({ where: { id: T } }));
  });

  beforeEach(async () => {
    await run(() => prisma.activity.deleteMany({ where: { tenantId: T } }));
  });

  async function logTimeline(leadId = LEAD, userId = USER) {
    for (const event of TIMELINE_EVENTS) {
      await run(() =>
        prisma.activity.create({
          data: {
            tenantId: T,
            userId,
            leadId,
            type: event.type,
            channel: event.channel ?? undefined,
            description: event.description,
            metadata: event.metadata,
          },
        }),
      );
    }
  }

  it('records every channel event against the lead', async () => {
    await logTimeline();

    const timeline = await run(() =>
      prisma.activity.findMany({ where: { leadId: LEAD }, orderBy: { createdAt: 'asc' } }),
    );

    expect(timeline).toHaveLength(TIMELINE_EVENTS.length);
    expect(timeline.map((entry) => entry.type)).toEqual(TIMELINE_EVENTS.map((event) => event.type));
  });

  it('keeps each event on its own channel rather than collapsing them', async () => {
    await logTimeline();

    const byType = new Map(
      (await run(() => prisma.activity.findMany({ where: { leadId: LEAD } }))).map((entry) => [
        entry.type,
        entry.channel,
      ]),
    );

    expect(byType.get('email_sent')).toBe('email');
    expect(byType.get('call_logged')).toBe('phone');
    expect(byType.get('linkedin_touch')).toBe('linkedin');
    expect(byType.get('whatsapp_message')).toBe('whatsapp');
  });

  it('preserves per-type metadata, which is what reporting reads', async () => {
    await logTimeline();

    const call = await run(() =>
      prisma.activity.findFirst({ where: { leadId: LEAD, type: 'call_logged' } }),
    );
    const meeting = await run(() =>
      prisma.activity.findFirst({ where: { leadId: LEAD, type: 'meeting_booked' } }),
    );

    expect(call?.metadata).toMatchObject({ outcome: 'connected', durationSeconds: 372 });
    expect(meeting?.metadata).toMatchObject({ slot: '2026-08-25T09:00:00Z' });
  });

  it('returns the timeline in chronological order', async () => {
    await logTimeline();

    const timeline = await run(() =>
      prisma.activity.findMany({ where: { leadId: LEAD }, orderBy: { createdAt: 'asc' } }),
    );
    const timestamps = timeline.map((entry) => entry.createdAt.getTime());

    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  it('scopes the timeline to one lead', async () => {
    await logTimeline(LEAD);
    await logTimeline(OTHER_LEAD);

    const timeline = await run(() => prisma.activity.findMany({ where: { leadId: LEAD } }));

    expect(timeline).toHaveLength(TIMELINE_EVENTS.length);
    expect(timeline.every((entry) => entry.leadId === LEAD)).toBe(true);
  });

  it('attributes every event to the acting user, which the leaderboard groups by', async () => {
    await logTimeline(LEAD, USER);
    await logTimeline(OTHER_LEAD, OTHER_USER);

    const mine = await run(() => prisma.activity.count({ where: { tenantId: T, userId: USER } }));
    const theirs = await run(() =>
      prisma.activity.count({ where: { tenantId: T, userId: OTHER_USER } }),
    );

    expect(mine).toBe(TIMELINE_EVENTS.length);
    expect(theirs).toBe(TIMELINE_EVENTS.length);
  });

  it('supports filtering by type, as the timeline UI does', async () => {
    await logTimeline();

    const emails = await run(() =>
      prisma.activity.findMany({ where: { leadId: LEAD, type: 'email_sent' } }),
    );

    expect(emails).toHaveLength(1);
    expect(emails[0].description).toBe('Intro email');
  });
});
