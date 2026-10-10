import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * One call count on every surface (dialer Phase 8), against a real database.
 *
 * A mocked Prisma cannot show a double count: the whole point of `lib/telephony/metrics.ts` is the
 * join between `Call` rows and the Activities that shadow them. So the fixture is a mix of every
 * source and the expected numbers are written out by hand, once, for the metrics and for each
 * surface that used to count on its own.
 *
 * Golden fixture, tenant T, 2026-03-10 (all rows in the range):
 *
 *   rep S
 *     1. softphone Call, answered, + linked call_made (metadata.callId)        lead L1  attempt + connected
 *     2. softphone Call, no answer, + linked call_made                         lead L1  attempt
 *     3. blocked Call (never initiated), and an authorized-never-initiated one lead L2  nothing
 *     4. phone-panel call_logged, outcome connected_interested                 lead L2  attempt + connected
 *     5. legacy call_made, no outcome, no Call                                 lead L1  attempt
 *     6. inbound answered Call + its linked call_made                          lead L1  nothing (outbound only)
 *   rep B
 *     7. phone-panel call_logged, outcome no_answer                            lead L3  attempt
 *     8. legacy task call_logged, outcome connected_not_interested (18:00Z)    lead L3  attempt + connected
 *     9. Call, no answer, linked to its call_made ONLY through Call.activityId lead L3  attempt
 *   tenant O (other tenant): a Call + call_made + call_logged, all ignored.
 *
 * attempts S=4, B=3 (7); connected S=2, B=1 (3); by lead L1=3 L2=1 L3=3.
 * Before the change: the leaderboard / My Day counted every call_made and call_logged, so S read 5
 * (the inbound call's activity) and a rep-only count could never include a Call without an activity.
 */

const requireManager = vi.fn();
const requireAuth = vi.fn();

// next-auth does not load under Vitest, so the session helpers are replaced outright. The fixture
// viewer is a director: no visibility window and no lead scope, which is what a manager's view is.
vi.mock('@/lib/auth', () => ({
  requireManager: (...a: unknown[]) => requireManager(...a),
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  getVisibleUserIds: async () => null,
  getLeadWhereScope: async () => ({}),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { countCalls, countCallsBy } = await import('@/lib/telephony/metrics');
type CallRange = import('@/lib/telephony/metrics').CallRange;
const { getMyDay } = await import('@/lib/dashboard/myDay');
const { buildReportMetrics } = await import('@/lib/client-reports/metrics');
const { recalculateContactIntelligence } = await import('@/lib/contact-intelligence/service');
const { GET: leaderboardGET } = await import('@/app/api/team/leaderboard/route');
const { GET: campaignGET } = await import('@/app/api/team/campaigns/[id]/route');
const { runAs, setupWorkOrderFixture } = await import('./helpers/workOrderFixture');
type WorkOrderFixture = Awaited<ReturnType<typeof setupWorkOrderFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const PREFIX = 'callmetrics';
const FROM = new Date('2026-03-10T00:00:00.000Z');
const TO = new Date('2026-03-10T23:59:59.999Z');
const NOON = new Date('2026-03-10T12:00:00.000Z');
const EVENING = new Date('2026-03-10T18:00:00.000Z');
const RANGE = { from: FROM, to: TO };

let fx: WorkOrderFixture;
let repB: string;
let clientId: string;
let contactId: string;
let leadIds: { l1: string; l2: string; l3: string };

const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);
/** As a signed-in request: tenant-scoped, not the bypass the fixture setup uses. */
const asSession = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: fx.tenantId }, fn);

async function clearRows() {
  for (const tenantId of [`${PREFIX}-tenant`, `${PREFIX}-other-tenant`]) {
    await runAs(tenantId, async () => {
      await prisma.call.deleteMany({ where: { tenantId } });
      await prisma.activity.deleteMany({ where: { tenantId } });
    });
  }
}

async function dropFixtureDependents() {
  const tenantId = `${PREFIX}-tenant`;
  await runAs(tenantId, async () => {
    await prisma.contactIntelligence.deleteMany({ where: { tenantId } });
    await prisma.lead.updateMany({ where: { tenantId }, data: { contactId: null } });
    await prisma.lead.updateMany({ where: { tenantId, assignedToId: `${PREFIX}-rep-b` }, data: { assignedToId: `${PREFIX}-sdr` } });
    await prisma.contact.deleteMany({ where: { tenantId } });
    await prisma.campaignSdr.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId, id: `${PREFIX}-rep-b` } });
  });
}

function activity(data: {
  tenantId?: string;
  userId: string;
  leadId: string;
  type: 'call_made' | 'call_logged';
  at: Date;
  metadata?: Record<string, unknown>;
}) {
  return prisma.activity.create({
    data: {
      tenantId: data.tenantId ?? fx.tenantId,
      userId: data.userId,
      leadId: data.leadId,
      type: data.type,
      channel: 'phone',
      metadata: (data.metadata ?? {}) as object,
      createdAt: data.at,
    },
  });
}

function call(data: {
  tenantId?: string;
  userId?: string | null;
  leadId: string | null;
  direction?: 'outbound' | 'inbound';
  status: 'blocked' | 'authorized' | 'completed' | 'no_answer';
  initiatedAt?: Date | null;
  answeredAt?: Date | null;
  activityId?: string | null;
  session: string;
}) {
  return prisma.call.create({
    data: {
      tenantId: data.tenantId ?? fx.tenantId,
      direction: data.direction ?? 'outbound',
      status: data.status,
      userId: data.userId,
      leadId: data.leadId,
      toE164: '+84900000000',
      provider: 'telnyx',
      providerSessionId: `${PREFIX}-${data.session}`,
      authorizedAt: NOON,
      initiatedAt: data.initiatedAt ?? null,
      answeredAt: data.answeredAt ?? null,
      endedAt: data.initiatedAt ? new Date(data.initiatedAt.getTime() + 60_000) : null,
      activityId: data.activityId ?? null,
    },
  });
}

async function seedGolden() {
  const { l1, l2, l3 } = leadIds;
  const S = fx.sdrId;
  const B = repB;

  // 1. answered softphone call + linked call_made
  const a1 = await activity({ userId: S, leadId: l1, type: 'call_made', at: NOON, metadata: { callId: 'c1' } });
  await call({ userId: S, leadId: l1, status: 'completed', initiatedAt: NOON, answeredAt: NOON, activityId: a1.id, session: 'c1' });
  // 2. no-answer softphone call + linked call_made
  const a2 = await activity({ userId: S, leadId: l1, type: 'call_made', at: NOON, metadata: { callId: 'c2' } });
  await call({ userId: S, leadId: l1, status: 'no_answer', initiatedAt: NOON, activityId: a2.id, session: 'c2' });
  // 3. blocked and authorized-never-initiated
  await call({ userId: S, leadId: l2, status: 'blocked', session: 'c3a' });
  await call({ userId: S, leadId: l2, status: 'authorized', session: 'c3b' });
  // 4. phone panel, connected
  await activity({ userId: S, leadId: l2, type: 'call_logged', at: NOON, metadata: { via: 'phone', outcome: 'connected_interested' } });
  // 5. legacy call_made with no Call
  await activity({ userId: S, leadId: l1, type: 'call_made', at: NOON });
  // 6. inbound answered call + its call_made: not an outbound attempt
  const a6 = await activity({ userId: S, leadId: l1, type: 'call_made', at: NOON, metadata: { callId: 'c6' } });
  await call({ userId: S, leadId: l1, direction: 'inbound', status: 'completed', initiatedAt: NOON, answeredAt: NOON, activityId: a6.id, session: 'c6' });
  // 7, 8
  await activity({ userId: B, leadId: l3, type: 'call_logged', at: NOON, metadata: { via: 'phone', outcome: 'no_answer' } });
  await activity({ userId: B, leadId: l3, type: 'call_logged', at: EVENING, metadata: { outcome: 'connected_not_interested', taskTitle: 'Call' } });
  // 9. linked only through Call.activityId (no metadata.callId)
  const a9 = await activity({ userId: B, leadId: l3, type: 'call_made', at: NOON });
  await call({ userId: B, leadId: l3, status: 'no_answer', initiatedAt: NOON, activityId: a9.id, session: 'c9' });
  // other tenant
  const otherLead = fx.otherTenantLeadId;
  const O = `${PREFIX}-other-director`;
  const ao = await activity({ tenantId: `${PREFIX}-other-tenant`, userId: O, leadId: otherLead, type: 'call_made', at: NOON, metadata: { callId: 'co' } });
  await call({ tenantId: `${PREFIX}-other-tenant`, userId: O, leadId: otherLead, status: 'completed', initiatedAt: NOON, answeredAt: NOON, activityId: ao.id, session: 'co' });
  await activity({ tenantId: `${PREFIX}-other-tenant`, userId: O, leadId: otherLead, type: 'call_logged', at: NOON, metadata: { outcome: 'connected_interested' } });
}

beforeAll(async () => {
  if (!hasDb) return;
  await runAs(`${PREFIX}-tenant`, async () => {
    await prisma.call.deleteMany({ where: { tenantId: `${PREFIX}-tenant` } });
    await prisma.activity.deleteMany({ where: { tenantId: `${PREFIX}-tenant` } });
  });
  await dropFixtureDependents().catch(() => undefined);
  fx = await setupWorkOrderFixture(PREFIX);
  repB = `${PREFIX}-rep-b`;
  await run(async () => {
    await prisma.user.create({
      data: { id: repB, email: `${repB}@session-fixture.test`, password: 'hashed', firstName: 'Bea', lastName: 'Second', role: 'sdr', tenantId: fx.tenantId },
    });
    await prisma.user.update({ where: { id: fx.sdrId }, data: { timezone: 'UTC' } });
    const campaign = await prisma.campaign.findFirstOrThrow({ where: { id: fx.campaignId } });
    clientId = campaign.clientId;
    await prisma.campaignSdr.createMany({
      data: [fx.sdrId, repB].map((userId) => ({ campaignId: fx.campaignId, userId, tenantId: fx.tenantId })),
    });
    leadIds = { l1: fx.idleLeadId, l2: fx.enrolledLeadId, l3: fx.humanManagedLeadId };
    await prisma.lead.update({ where: { id: leadIds.l3 }, data: { assignedToId: repB } });
    const contact = await prisma.contact.create({
      data: { firstName: 'Cora', lastName: 'Contact', company: 'Acme', email: `${PREFIX}-cora@acme.test`, tenantId: fx.tenantId },
    });
    contactId = contact.id;
    await prisma.lead.updateMany({ where: { id: { in: [leadIds.l1, leadIds.l2] } }, data: { contactId } });
  });
});

afterAll(async () => {
  if (!hasDb) return;
  await clearRows();
  await dropFixtureDependents();
});

beforeEach(async () => {
  if (!hasDb) return;
  await clearRows();
  await run(seedGolden);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-10T20:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  requireManager.mockReset();
  requireAuth.mockReset();
});

const count = (mode: 'attempts' | 'connected', scope = {}, range: CallRange = RANGE, tenantId = `${PREFIX}-tenant`) =>
  run(() => countCalls({ tenantId, scope, range, mode }));

suite('countCalls - golden fixture', () => {
  it('counts attempts once per call, across all three sources', async () => {
    expect(await count('attempts')).toBe(7);
  });

  it('counts connected calls: answered Call rows and connected-outcome activities', async () => {
    expect(await count('connected')).toBe(3);
  });

  it('scopes by rep', async () => {
    expect(await count('attempts', { userIds: [fx.sdrId] })).toBe(4);
    expect(await count('attempts', { userIds: [repB] })).toBe(3);
    expect(await count('connected', { userIds: [fx.sdrId] })).toBe(2);
    expect(await count('connected', { userIds: [repB] })).toBe(1);
    expect(await count('attempts', { userIds: [] })).toBe(0);
  });

  it('scopes by lead, campaign, client and lead assignee', async () => {
    expect(await count('attempts', { leadIds: [leadIds.l1] })).toBe(3);
    expect(await count('attempts', { leadIds: [leadIds.l2] })).toBe(1);
    expect(await count('attempts', { leadIds: [] })).toBe(0);
    expect(await count('attempts', { campaignId: fx.campaignId })).toBe(7);
    expect(await count('attempts', { clientId })).toBe(7);
    expect(await count('attempts', { clientId, campaignId: 'no-such-campaign' })).toBe(0);
    expect(await count('attempts', { leadAssignedToIds: [repB] })).toBe(3);
    expect(await count('attempts', { campaignId: fx.campaignId, userIds: [fx.sdrId], leadAssignedToIds: [repB] })).toBe(0);
  });

  it('ignores the other tenant, and the other tenant sees only its own', async () => {
    expect(await count('attempts', { userIds: [`${PREFIX}-other-director`] })).toBe(0);
    expect(await count('attempts', {}, RANGE, `${PREFIX}-other-tenant`)).toBe(2);
    expect(await count('connected', {}, RANGE, `${PREFIX}-other-tenant`)).toBe(2);
  });

  it('groups by rep, lead and day without losing or doubling a call', async () => {
    const base = { tenantId: fx.tenantId, mode: 'attempts' as const, range: RANGE };
    const byUser = await run(() => countCallsBy({ ...base, by: 'user' }));
    expect(Object.fromEntries(byUser)).toEqual({ [fx.sdrId]: 4, [repB]: 3 });
    const byLead = await run(() => countCallsBy({ ...base, by: 'lead' }));
    expect(Object.fromEntries(byLead)).toEqual({ [leadIds.l1]: 3, [leadIds.l2]: 1, [leadIds.l3]: 3 });
    const byDay = await run(() => countCallsBy({ ...base, by: 'day' }));
    expect(Object.fromEntries(byDay)).toEqual({ '2026-03-10': 7 });
    const byVnDay = await run(() => countCallsBy({ ...base, by: 'day', timezone: 'Asia/Ho_Chi_Minh' }));
    expect(Object.fromEntries(byVnDay)).toEqual({ '2026-03-10': 6, '2026-03-11': 1 });
    const connectedByUser = await run(() => countCallsBy({ ...base, mode: 'connected', by: 'user' }));
    expect(Object.fromEntries(connectedByUser)).toEqual({ [fx.sdrId]: 2, [repB]: 1 });
  });

  it('includes both range edges and excludes a millisecond outside them', async () => {
    const at = (iso: string, session: string) =>
      call({ userId: repB, leadId: leadIds.l1, status: 'no_answer', initiatedAt: new Date(iso), session });
    await run(async () => {
      await at('2026-03-09T23:59:59.999Z', 'e1');
      await at('2026-03-10T00:00:00.000Z', 'e2');
      await at('2026-03-10T23:59:59.999Z', 'e3');
      await at('2026-03-11T00:00:00.000Z', 'e4');
    });
    expect(await count('attempts')).toBe(9);
    expect(await count('attempts', {}, { from: FROM })).toBe(10);
    expect(await count('attempts', {}, { to: TO })).toBe(10);
    expect(await count('attempts', {}, {})).toBe(11);
  });
});

suite('every surface reads the same numbers', () => {
  it('My Day (rep S)', async () => {
    const day = await run(() => getMyDay({ id: fx.sdrId, tenantId: fx.tenantId, role: 'sdr' } as never, new Date()));
    expect(day.calls).toBe(4);
  });

  it('leaderboard', async () => {
    requireManager.mockResolvedValue({ id: fx.directorId, tenantId: fx.tenantId, role: 'director', isManager: true });
    const res = await asSession(() => leaderboardGET(new NextRequest('http://t/api/team/leaderboard?dateRange=month')));
    const rows = (await res.json()) as Array<{ id: string; calls: number }>;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.calls]))).toEqual({ [fx.sdrId]: 4, [repB]: 3 });
  });

  it('campaign stats', async () => {
    requireAuth.mockResolvedValue({ id: fx.directorId, tenantId: fx.tenantId, role: 'director', isManager: true });
    const res = await asSession(() =>
      campaignGET(new NextRequest(`http://t/api/team/campaigns/${fx.campaignId}?dateRange=month`), {
        params: Promise.resolve({ id: fx.campaignId }),
      }),
    );
    const body = (await res.json()) as { reps: Array<{ id: string; calls: number }> };
    expect(Object.fromEntries(body.reps.map((r) => [r.id, r.calls]))).toEqual({ [fx.sdrId]: 4, [repB]: 3 });
  });

  it('client report', async () => {
    const snapshot = await run(() =>
      buildReportMetrics({
        clientId,
        campaignId: fx.campaignId,
        periodStart: FROM,
        periodEnd: TO,
        generatedById: fx.directorId,
        generatedByName: 'Dee Rector',
      }),
    );
    const callChannel = snapshot.channels.find((c) => c.channel === 'call');
    expect(callChannel?.touchpoints).toBe(7);
    expect(snapshot.reps.reduce((sum, rep) => sum + rep.touchpoints, 0)).toBe(7);
  });

  it('contact intelligence (leads L1 and L2)', async () => {
    const intel = await run(() => recalculateContactIntelligence(contactId, fx.tenantId));
    expect(intel.touchCount).toBe(4);
  });
});
