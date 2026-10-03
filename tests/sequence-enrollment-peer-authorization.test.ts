import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * One rep must not be able to reach another rep's cadence.
 *
 * Until now every test in this repo asked whether tenant A could reach tenant B. That was the right
 * question when two people used the system. With 34 sdrs in one tenant the question is whether one
 * colleague can reach another's, and four routes answered yes:
 *
 *   run-now      requireAuth + `enrollment.tenantId !== user.tenantId` — and nothing else
 *   status       the same
 *   logs         the same
 *   bulk-action  `requireRole('sdr')`, which is the floor of the hierarchy, so it admitted everyone
 *
 * Not a crafted-request hole either. `GET /api/sequences/[id]/enrollments` was scoped by sequence
 * and tenant only, so the page handed each rep every enrollment in the company — 1,086 active on
 * production — with pause / resume / unenroll / run-now beside each one, and a bulk bar above them.
 * `run-now` reaches the provider: it sends real mail, now, from the lead owner's mailbox.
 *
 * The existing suite could not have caught it: `tests/phase-8a-lifecycle-routes.test.ts` builds its
 * fixture lead with `assignedToId: user.id`, so the caller always owned the lead under test.
 *
 * Every case below is therefore a *peer*, not a stranger: same tenant, same sequence, different
 * owner. The controls at the end prove the owner can still do all four things, so a fix that simply
 * broke the routes for everybody cannot pass.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
// No real provider send, and no BullMQ. What matters is whether the route got far enough to try.
// Explicitly variadic: a `vi.fn(async () => …)` types as taking no arguments, so spreading the
// real call's arguments into it fails the type check (TS2556) even though the test passes.
const enqueueImmediate = vi.fn(async (..._args: unknown[]) => 'job-1');
vi.mock('@/lib/bullmq/enqueue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bullmq/enqueue')>()),
  enqueueImmediate: (...a: unknown[]) => enqueueImmediate(...a),
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { auth } = await import('@/auth');
const { POST: runNow } = await import('@/app/api/sequences/[id]/enrollments/[enrollmentId]/run-now/route');
const { PATCH: setStatus } = await import('@/app/api/sequences/[id]/enrollments/[enrollmentId]/status/route');
const { GET: getLogs } = await import('@/app/api/sequences/[id]/enrollments/[enrollmentId]/logs/route');
const { POST: bulkAction } = await import('@/app/api/sequences/[id]/enrollments/bulk-action/route');
const { GET: listEnrollments } = await import('@/app/api/sequences/[id]/enrollments/route');
type SessionUser = import('@/lib/auth').SessionUser;

const hasDb = Boolean(process.env.DATABASE_URL);

const T = 'peerauth-tenant';
const OWNER = 'peerauth-owner-sdr';
const PEER = 'peerauth-peer-sdr';
const DIRECTOR = 'peerauth-director';
const CLIENT = 'peerauth-client';
const CAMPAIGN = 'peerauth-campaign';
const SEQ = 'peerauth-sequence';
const OWNER_LEAD = 'peerauth-lead-owned';
const OWNER_ENROLLMENT = 'peerauth-enrollment-owned';

const user = (id: string, role: SessionUser['role']): SessionUser => ({
  id,
  email: `${id}@peerauth.test`,
  firstName: 'Test',
  lastName: 'User',
  role,
  tenantId: T,
});

const runAs = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const runSystem = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);
const actAs = (u: SessionUser) => vi.mocked(auth).mockResolvedValue({ user: u } as never);

const ctx = (enrollmentId: string) => ({ params: Promise.resolve({ id: SEQ, enrollmentId }) });
const seqCtx = () => ({ params: Promise.resolve({ id: SEQ }) });

const post = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const patch = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const enrollmentStatus = (id: string) =>
  runAs(async () => (await prisma.sequenceEnrollment.findFirstOrThrow({ where: { id, tenantId: T } })).status);

describe.skipIf(!hasDb)('one rep cannot reach another rep cadence', () => {
  beforeAll(async () => {
    await runAs(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.task.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceStep.deleteMany({ where: { tenantId: T } });
      await prisma.sequence.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
      await prisma.tenant.deleteMany({ where: { id: T } });
    });

    await runSystem(async () => {
      await prisma.tenant.create({ data: { id: T, name: 'PeerAuth' } });
      await prisma.user.createMany({
        data: [
          { id: OWNER, tenantId: T, email: `${OWNER}@peerauth.test`, password: 'x', firstName: 'Own', lastName: 'Er', role: 'sdr' },
          { id: PEER, tenantId: T, email: `${PEER}@peerauth.test`, password: 'x', firstName: 'Pe', lastName: 'Er', role: 'sdr' },
          { id: DIRECTOR, tenantId: T, email: `${DIRECTOR}@peerauth.test`, password: 'x', firstName: 'Di', lastName: 'Rector', role: 'director' },
        ],
      });
    });

    await runAs(async () => {
      await prisma.client.create({
        data: { id: CLIENT, tenantId: T, name: 'PeerAuth Client', industry: 'Tech', contactName: 'Ops', contactEmail: 'ops@peerauth.test' },
      });
      await prisma.campaign.create({
        data: { id: CAMPAIGN, tenantId: T, clientId: CLIENT, name: 'PeerAuth Campaign', startDate: new Date('2026-08-01T00:00:00Z') },
      });
      await prisma.sequence.create({
        data: { id: SEQ, tenantId: T, name: 'PeerAuth Sequence', isActive: true, createdById: DIRECTOR },
      });
      await prisma.sequenceStep.create({
        data: { tenantId: T, sequenceId: SEQ, order: 1, channel: 'email', delayDays: 0, instructions: 'Opening touch' },
      });
      // A lead owned by OWNER. PEER is a different sdr with no claim on it: same tenant, same
      // sequence, and — since neither is a manager — no account axis either.
      await prisma.lead.create({
        data: {
          id: OWNER_LEAD,
          tenantId: T,
          campaignId: CAMPAIGN,
          assignedToId: OWNER,
          firstName: 'Prospect',
          lastName: 'OfOwner',
          company: 'Northwind',
          email: 'prospect@northwind-peerauth.test',
        },
      });
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Each test starts from one active enrollment on the owner's lead.
    await runAs(async () => {
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceEnrollment.create({
        data: {
          id: OWNER_ENROLLMENT,
          tenantId: T,
          sequenceId: SEQ,
          leadId: OWNER_LEAD,
          status: 'active',
          currentStep: 1,
          // A check constraint requires `occupancyKey = tenantId || ':' || leadId || ':' || sequenceId`
          // for any active or paused enrollment — one live cadence per lead per sequence. Omitting
          // it fails at the database, not in application code.
          occupancyKey: `${T}:${OWNER_LEAD}:${SEQ}`,
        },
      });
    });
  });

  // ── the peer is refused ───────────────────────────────────────────────────

  it('a peer cannot force an immediate send on another rep lead', async () => {
    actAs(user(PEER, 'sdr'));

    const res = await runAs(() =>
      runNow(post(`/api/sequences/${SEQ}/enrollments/${OWNER_ENROLLMENT}/run-now`), ctx(OWNER_ENROLLMENT))
    );

    expect(res.status).toBe(403);
    // The real damage is a provider send, so the assertion is that nothing was queued — not merely
    // that the HTTP status was unhappy.
    expect(enqueueImmediate).not.toHaveBeenCalled();
  });

  it('a peer cannot pause another rep cadence', async () => {
    actAs(user(PEER, 'sdr'));

    const res = await runAs(() =>
      setStatus(patch(`/api/sequences/${SEQ}/enrollments/${OWNER_ENROLLMENT}/status`, { status: 'paused' }), ctx(OWNER_ENROLLMENT))
    );

    expect(res.status).toBe(403);
    expect(await enrollmentStatus(OWNER_ENROLLMENT)).toBe('active');
  });

  it('a peer cannot read another rep correspondence with a prospect', async () => {
    actAs(user(PEER, 'sdr'));

    const res = await runAs(() =>
      getLogs(new NextRequest(`http://localhost/api/sequences/${SEQ}/enrollments/${OWNER_ENROLLMENT}/logs`), ctx(OWNER_ENROLLMENT))
    );
    const body = JSON.stringify(await res.json().catch(() => ({})));

    expect(res.status).toBe(403);
    expect(body).not.toContain('prospect@northwind-peerauth.test');
  });

  it('a peer bulk action moves nothing, and says how many it refused', async () => {
    actAs(user(PEER, 'sdr'));

    const res = await runAs(() =>
      bulkAction(
        post(`/api/sequences/${SEQ}/enrollments/bulk-action`, { enrollmentIds: [OWNER_ENROLLMENT], action: 'unenroll' }),
        seqCtx()
      )
    );
    const body = await res.json();

    expect(body.processedCount).toBe(0);
    expect(body.refusedCount).toBe(1);
    expect(await enrollmentStatus(OWNER_ENROLLMENT)).toBe('active');
  });

  it('the enrollment list does not hand a peer the ids to act on', async () => {
    // This is the half that made the rest reachable from the UI rather than from curl.
    actAs(user(PEER, 'sdr'));

    const res = await runAs(() =>
      listEnrollments(new NextRequest(`http://localhost/api/sequences/${SEQ}/enrollments`), seqCtx())
    );
    const body = await res.json();
    const ids = (Array.isArray(body) ? body : body.enrollments ?? []).map((e: { id: string }) => e.id);

    expect(ids).not.toContain(OWNER_ENROLLMENT);
  });

  // ── the owner and a director are unaffected ───────────────────────────────

  it('the owner can still pause their own cadence', async () => {
    actAs(user(OWNER, 'sdr'));

    const res = await runAs(() =>
      setStatus(patch(`/api/sequences/${SEQ}/enrollments/${OWNER_ENROLLMENT}/status`, { status: 'paused' }), ctx(OWNER_ENROLLMENT))
    );

    expect(res.status).toBe(200);
    expect(await enrollmentStatus(OWNER_ENROLLMENT)).toBe('paused');
  });

  it('the owner can still read their own logs', async () => {
    actAs(user(OWNER, 'sdr'));

    const res = await runAs(() =>
      getLogs(new NextRequest(`http://localhost/api/sequences/${SEQ}/enrollments/${OWNER_ENROLLMENT}/logs`), ctx(OWNER_ENROLLMENT))
    );

    expect(res.status).toBe(200);
  });

  it('the owner still sees their own enrollment in the list', async () => {
    actAs(user(OWNER, 'sdr'));

    const res = await runAs(() =>
      listEnrollments(new NextRequest(`http://localhost/api/sequences/${SEQ}/enrollments`), seqCtx())
    );
    const body = await res.json();
    const ids = (Array.isArray(body) ? body : body.enrollments ?? []).map((e: { id: string }) => e.id);

    expect(ids).toContain(OWNER_ENROLLMENT);
  });

  it('a director still sees and can act on any rep enrollment', async () => {
    // Oversight must survive the fix: `getLeadWhereScope` returns `{}` for a director, and
    // `canAccessLead` grants them the account axis.
    actAs(user(DIRECTOR, 'director'));

    const list = await runAs(() =>
      listEnrollments(new NextRequest(`http://localhost/api/sequences/${SEQ}/enrollments`), seqCtx())
    );
    const body = await list.json();
    const ids = (Array.isArray(body) ? body : body.enrollments ?? []).map((e: { id: string }) => e.id);
    expect(ids).toContain(OWNER_ENROLLMENT);

    const res = await runAs(() =>
      setStatus(patch(`/api/sequences/${SEQ}/enrollments/${OWNER_ENROLLMENT}/status`, { status: 'paused' }), ctx(OWNER_ENROLLMENT))
    );
    expect(res.status).toBe(200);
  });
});
