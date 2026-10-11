/**
 * The personal-ICP review workflow and its permission matrix, against real Postgres and the real
 * authorization path (session revalidation, pod scoping, campaign visibility). Only the NextAuth
 * session and the Redis list cache are faked.
 *
 * Owner decisions 2026-10-11: library ICPs belong to director / floor manager / leadgen manager;
 * any rep may make a personal ICP for a campaign they work on, but an SDR's Publish only SUBMITS it;
 * a team lead whose pod includes the submitter, or a manager, approves it; nothing scores against a
 * version that is still in review.
 */
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  listKey: (...parts: string[]) => parts.join(':'),
  invalidateList: vi.fn(),
}));
let requestHeaders = new Headers();
// The Redis-backed limiter fails open without Redis; this lets a test close one bucket.
const limiter = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock('@/lib/security/attemptLimit', () => ({
  consumeAttempt: async ({ bucket }: { bucket: string }) =>
    limiter.deny.has(bucket)
      ? { allowed: false, remaining: 0, retryAfterSeconds: 30 }
      : { allowed: true, remaining: 1, retryAfterSeconds: 0 },
}));
vi.mock('next/headers', () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: vi.fn() }),
}));

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { resolveCampaignIcp } from '@/lib/leadgen/scorePoolItem';
import { POST as postCampaign } from '@/app/api/campaigns/route';
import { PATCH as patchCampaignIcp } from '@/app/api/icp/campaigns/[id]/route';
import { GET as getProfiles, POST as postProfile } from '@/app/api/icp/profiles/route';
import { POST as postDefault } from '@/app/api/icp/profiles/[id]/default/route';
import { GET as getReviews } from '@/app/api/icp/reviews/route';
import { POST as postClone } from '@/app/api/icp/versions/route';
import { PATCH as patchVersion } from '@/app/api/icp/versions/[id]/route';
import { POST as postApprove } from '@/app/api/icp/versions/[id]/approve/route';
import { POST as postPreview } from '@/app/api/icp/versions/[id]/preview-score/route';
import { POST as postPublish } from '@/app/api/icp/versions/[id]/publish/route';
import { POST as postReject } from '@/app/api/icp/versions/[id]/reject/route';
import { POST as postWithdraw } from '@/app/api/icp/versions/[id]/withdraw/route';
import { GET as getPublishedVersions } from '@/app/api/icp/versions/route';
import { POST as postResearchPreview } from '@/app/api/research/preview/route';
import { POST as postResearchRun } from '@/app/api/research/runs/route';
import { POST as postRescore } from '@/app/api/leads/rescore-icp/route';

type Role = 'director' | 'floor_manager' | 'leadgen_manager' | 'team_lead' | 'sdr';
type Actor = { id: string; role: Role; tenantId: string };

const tenantId = `t-icprev-${randomUUID()}`;
const otherTenantId = `t-icprev-other-${randomUUID()}`;
const ids: Record<string, string> = {};
const actors: Record<string, Actor> = {};
const db = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

function rules(title = 'CEO') {
  const r = emptyIcpRulesV2('rs', 'ICP');
  r.persona.titleAllowlist = [title];
  return r;
}

function signInAs(actor: Actor | null) {
  (auth as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    actor
      ? { user: { id: actor.id, role: actor.role, tenantId: actor.tenantId, email: `${actor.id}@t.test`, firstName: 'F', lastName: 'L' }, expires: '' }
      : null,
  );
}

const jsonReq = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeUser(key: string, role: Role, managerKey?: string) {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${key}.${randomUUID()}@t.test`,
      firstName: key,
      lastName: 'T',
      role,
      password: 'x',
      isActive: true,
      managerId: managerKey ? ids[managerKey] : null,
    },
  });
  ids[key] = user.id;
  actors[key] = { id: user.id, role, tenantId };
}

beforeAll(async () => {
  await prisma.tenant.createMany({ data: [{ id: tenantId, name: 'ICP review' }, { id: otherTenantId, name: 'Other' }] });
  await db(async () => {
    await makeUser('dir', 'director');
    await makeUser('fm', 'floor_manager');
    await makeUser('lm', 'leadgen_manager');
    await makeUser('tl1', 'team_lead', 'fm');
    await makeUser('tl2', 'team_lead', 'fm');
    await makeUser('s1', 'sdr', 'tl1');
    await makeUser('s3', 'sdr', 'tl1');
    await makeUser('s2', 'sdr', 'tl2');
    const client = await prisma.client.create({
      data: { tenantId, name: `C ${randomUUID()}`, industry: 'Software', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` },
    });
    ids.client = client.id;
    for (const [key, members] of [['c1', ['s1', 's3', 'tl1']], ['c2', ['s2', 'tl2']]] as const) {
      const campaign = await prisma.campaign.create({
        data: { tenantId, clientId: client.id, name: `Camp ${key} ${randomUUID().slice(0, 4)}`, startDate: new Date() },
      });
      ids[key] = campaign.id;
      for (const member of members) {
        await prisma.campaignSdr.create({ data: { tenantId, campaignId: campaign.id, userId: ids[member] } });
      }
    }
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

beforeEach(async () => {
  requestHeaders = new Headers();
  limiter.deny.clear();
  signInAs(null);
  // Campaigns start with no ICP, so tests that attach one start from the same place.
  await db(() => prisma.campaign.updateMany({ where: { id: { in: [ids.c1, ids.c2] } }, data: { icpProfileId: null, icpVersionId: null } }));
});

/** A published shared ICP, as a library manager would have left it. */
async function libraryIcp(name = `Lib ${randomUUID().slice(0, 6)}`) {
  return db(async () => {
    const profile = await prisma.icpProfile.create({ data: { tenantId, name, kind: 'library' } });
    const version = await prisma.icpVersion.create({
      data: { tenantId, icpProfileId: profile.id, versionNumber: 1, status: 'published', rulesJson: rules() as never, publishedAt: new Date() },
    });
    return { profile, version };
  });
}

/** A custom ICP owned by `owner` with one version in the given state. */
async function customIcp(owner: string, status: 'draft' | 'pending_review' | 'published', extra: Record<string, unknown> = {}) {
  return db(async () => {
    const profile = await prisma.icpProfile.create({
      data: { tenantId, name: `Custom ${randomUUID().slice(0, 6)}`, kind: 'custom', ownerUserId: ids[owner] },
    });
    const version = await prisma.icpVersion.create({
      data: {
        tenantId,
        icpProfileId: profile.id,
        versionNumber: 1,
        status,
        rulesJson: rules() as never,
        ...(status === 'pending_review' ? { submittedById: ids[owner], submittedAt: new Date() } : {}),
        ...(status === 'published' ? { publishedAt: new Date() } : {}),
        ...extra,
      },
    });
    return { profile, version };
  });
}

const reload = (versionId: string) => db(() => prisma.icpVersion.findUniqueOrThrow({ where: { id: versionId } }));
const auditActions = (recordId: string) =>
  db(async () => (await prisma.auditLog.findMany({ where: { recordId }, select: { action: true } })).map((row) => row.action));

const createProfile = (body: unknown) => postProfile(jsonReq('http://t/api/icp/profiles', 'POST', body));
/** What a reviewer would send: the submission as they saw it. */
const submittedAtOf = async (versionId: string) => (await reload(versionId)).submittedAt?.toISOString() ?? new Date().toISOString();
const approve = async (versionId: string, submittedAt?: string) =>
  postApprove(jsonReq('http://t/x', 'POST', { expectedSubmittedAt: submittedAt ?? (await submittedAtOf(versionId)) }), ctx(versionId));
const reject = async (versionId: string, note: string, submittedAt?: string) =>
  postReject(jsonReq('http://t/x', 'POST', { note, expectedSubmittedAt: submittedAt ?? (await submittedAtOf(versionId)) }), ctx(versionId));
const publish = (versionId: string, updatedAt: Date) =>
  postPublish(jsonReq('http://t/x', 'POST', { expectedUpdatedAt: updatedAt.toISOString() }), ctx(versionId));
const assign = (campaignId: string, icpVersionId: string | null) =>
  patchCampaignIcp(jsonReq('http://t/x', 'PATCH', { icpVersionId }), ctx(campaignId));
const save = (versionId: string, updatedAt: Date, r = rules('CTO')) =>
  patchVersion(jsonReq('http://t/x', 'PATCH', { expectedUpdatedAt: updatedAt.toISOString(), rulesJson: r }), ctx(versionId));

describe('creating a personal ICP', () => {
  it('an SDR can create one for a campaign they work on: custom, owned by them, a draft', async () => {
    signInAs(actors.s1);
    const res = await createProfile({ campaignId: ids.c1, templateId: undefined });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.profile).toMatchObject({ kind: 'custom', ownerUserId: ids.s1, isDefault: false });
    expect(body.version.status).toBe('draft');
    expect(await auditActions(body.profile.id)).toContain('admin.icp.create');
  });

  it('needs a campaign the SDR can see, and refuses a library ICP', async () => {
    signInAs(actors.s1);
    expect((await createProfile({})).status).toBe(400);
    expect((await createProfile({ campaignId: ids.c2 })).status).toBe(404);
    expect((await createProfile({ campaignId: ids.c1, kind: 'library', name: 'Mine' })).status).toBe(403);
  });

  it('copies a library ICP when asked, and keeps its rules', async () => {
    const lib = await libraryIcp();
    signInAs(actors.s1);
    const res = await createProfile({ campaignId: ids.c1, sourceProfileId: lib.profile.id });
    expect(res.status).toBe(201);
    const version = await reload((await res.json()).version.id);
    expect((version.rulesJson as { persona: { titleAllowlist: string[] } }).persona.titleAllowlist).toEqual(['CEO']);
  });

  it("will not copy another rep's custom ICP (it looks missing)", async () => {
    const theirs = await customIcp('s2', 'published');
    signInAs(actors.s1);
    expect((await createProfile({ campaignId: ids.c1, sourceProfileId: theirs.profile.id })).status).toBe(404);
  });

  it("prefills a blank ICP from the campaign's lead requirement", async () => {
    await db(() =>
      prisma.campaignLeadRequirement.create({
        data: {
          tenantId,
          campaignId: ids.c1,
          requiredCount: 10,
          targetTitles: ['Head of Sales'],
          targetCountries: ['Vietnam'],
          targetIndustries: ['Logistics'],
          companySizeMin: 20,
          createdById: ids.tl1,
        },
      }),
    );
    signInAs(actors.s1);
    const body = await (await createProfile({ campaignId: ids.c1 })).json();
    const r = (await reload(body.version.id)).rulesJson as ReturnType<typeof rules>;
    expect(r.persona.titleAllowlist).toEqual(['Head of Sales']);
    expect(r.geography.targetCountries).toEqual(['Vietnam']);
    expect(r.industry.targetIndustries).toEqual(['Logistics']);
    expect(r.size.minEmployees).toBe(20);
    await db(() => prisma.campaignLeadRequirement.deleteMany({ where: { campaignId: ids.c1 } }));
  });
});

describe('who can edit what', () => {
  it('an SDR cannot edit or start an edit of a library ICP', async () => {
    const lib = await libraryIcp();
    const draft = await db(() =>
      prisma.icpVersion.create({ data: { tenantId, icpProfileId: lib.profile.id, versionNumber: 2, status: 'draft', rulesJson: rules() as never } }),
    );
    signInAs(actors.s1);
    expect((await save(draft.id, draft.updatedAt)).status).toBe(403);
    const clone = await postClone(jsonReq('http://t/x', 'POST', { sourceVersionId: lib.version.id }));
    expect(clone.status).toBe(403);
  });

  it("an SDR edits their own draft; another SDR and a team lead outside the chain get 404, a team lead in the chain 403", async () => {
    const mine = await customIcp('s1', 'draft');
    signInAs(actors.s1);
    expect((await save(mine.version.id, mine.version.updatedAt)).status).toBe(200);
    const fresh = await reload(mine.version.id);

    signInAs(actors.s2);
    expect((await save(mine.version.id, fresh.updatedAt)).status).toBe(404);
    signInAs(actors.tl2);
    expect((await save(mine.version.id, fresh.updatedAt)).status).toBe(404);
    signInAs(actors.tl1);
    expect((await save(mine.version.id, fresh.updatedAt)).status).toBe(403);
    signInAs(actors.dir);
    expect((await save(mine.version.id, fresh.updatedAt)).status).toBe(200);
  });

  it('library managers publish library ICPs; a team lead cannot, nor create or template one', async () => {
    const lib = await libraryIcp();
    const draft = await db(() =>
      prisma.icpVersion.create({ data: { tenantId, icpProfileId: lib.profile.id, versionNumber: 2, status: 'draft', rulesJson: rules('CFO') as never } }),
    );
    signInAs(actors.tl1);
    expect((await publish(draft.id, draft.updatedAt)).status).toBe(403);
    expect((await createProfile({ kind: 'library', name: 'Team lead library' })).status).toBe(403);
    expect((await postDefault(jsonReq('http://t/x', 'POST'), ctx(lib.profile.id))).status).toBe(403);

    for (const [index, manager] of ['fm', 'lm'].entries()) {
      const d = await db(() =>
        prisma.icpVersion.create({ data: { tenantId, icpProfileId: lib.profile.id, versionNumber: 10 + index, status: 'draft', rulesJson: rules(manager) as never } }),
      );
      signInAs(actors[manager]);
      const res = await publish(d.id, d.updatedAt);
      expect(res.status).toBe(200);
      expect((await res.json()).outcome).toBe('published');
    }
    signInAs(actors.dir);
    expect((await postDefault(jsonReq('http://t/x', 'POST'), ctx(lib.profile.id))).status).toBe(200);
  });

  it('only a library ICP can be the template', async () => {
    const mine = await customIcp('tl1', 'published');
    signInAs(actors.dir);
    expect((await postDefault(jsonReq('http://t/x', 'POST'), ctx(mine.profile.id))).status).toBe(409);
  });

  it('every ICP reader sees library ICPs; custom ones only in their chain', async () => {
    const lib = await libraryIcp('Visible library');
    const s2Icp = await customIcp('s2', 'draft');
    const names = async (actor: Actor) => {
      signInAs(actor);
      const body = await (await getProfiles()).json();
      return body.profiles.map((p: { id: string }) => p.id) as string[];
    };
    expect(await names(actors.s1)).toContain(lib.profile.id);
    expect(await names(actors.s1)).not.toContain(s2Icp.profile.id);
    expect(await names(actors.tl1)).not.toContain(s2Icp.profile.id);
    expect(await names(actors.tl2)).toContain(s2Icp.profile.id);
    expect(await names(actors.lm)).toContain(s2Icp.profile.id);
    signInAs(actors.s1);
    const listed = (await (await getProfiles()).json()).profiles.find((p: { id: string }) => p.id === lib.profile.id);
    expect(listed).toMatchObject({ canEdit: false, publishMode: null });
  });
});

describe('submit, review, approve', () => {
  it('an SDR Publish submits for review: pending_review, never published, audited, then locked', async () => {
    const mine = await customIcp('s1', 'draft');
    signInAs(actors.s1);
    const res = await publish(mine.version.id, mine.version.updatedAt);
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('submitted');
    const after = await reload(mine.version.id);
    expect(after).toMatchObject({ status: 'pending_review', submittedById: ids.s1 });
    expect(after.submittedAt).not.toBeNull();
    expect(after.publishedAt).toBeNull();
    expect(await auditActions(mine.version.id)).toContain('admin.icp.submit');
    expect((await save(mine.version.id, after.updatedAt)).status).toBe(409);
  });

  it('a pending ICP cannot be attached, and never scores', async () => {
    const pending = await customIcp('s1', 'pending_review');
    signInAs(actors.s1);
    const res = await assign(ids.c1, pending.version.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('pending_review');

    // Even a campaign already pointing at the profile (as campaign create does) is not scored.
    const campaign = await db(() => prisma.campaign.create({ data: { tenantId, clientId: ids.client, name: `P ${randomUUID()}`, startDate: new Date(), icpProfileId: pending.profile.id } }));
    const resolved = await db(() => resolveCampaignIcp(tenantId, campaign.id));
    expect(resolved.ok).toBe(false);
  });

  it("a team lead approves only their own chain's submissions; a manager approves any", async () => {
    const mine = await customIcp('s1', 'pending_review');
    const theirs = await customIcp('s2', 'pending_review');

    signInAs(actors.tl1);
    expect((await approve(theirs.version.id)).status).toBe(404);
    const queue = await (await getReviews(new NextRequest('http://t/api/icp/reviews'))).json();
    const queued = queue.reviews.map((r: { id: string }) => r.id);
    expect(queued).toContain(mine.version.id);
    expect(queued).not.toContain(theirs.version.id);
    const countOnly = await (await getReviews(new NextRequest('http://t/api/icp/reviews?countOnly=1'))).json();
    expect(countOnly.count).toBeGreaterThanOrEqual(1);

    expect((await approve(mine.version.id)).status).toBe(200);
    const approved = await reload(mine.version.id);
    expect(approved).toMatchObject({ status: 'published', reviewedById: ids.tl1 });
    expect(approved.reviewedAt).not.toBeNull();
    expect(await auditActions(mine.version.id)).toContain('admin.icp.approve');

    signInAs(actors.fm);
    expect((await approve(theirs.version.id)).status).toBe(200);
  });

  it('an SDR cannot approve or read the queue, not even their own; an approved ICP then scores', async () => {
    const mine = await customIcp('s1', 'pending_review');
    signInAs(actors.s1);
    expect((await approve(mine.version.id)).status).toBe(403);
    expect((await getReviews(new NextRequest('http://t/api/icp/reviews'))).status).toBe(403);

    const campaign = await db(() => prisma.campaign.create({ data: { tenantId, clientId: ivs(), name: `Q ${randomUUID()}`, startDate: new Date(), icpProfileId: mine.profile.id } }));
    expect((await db(() => resolveCampaignIcp(tenantId, campaign.id))).ok).toBe(false);
    signInAs(actors.tl1);
    await approve(mine.version.id);
    const resolved = await db(() => resolveCampaignIcp(tenantId, campaign.id));
    expect(resolved).toMatchObject({ ok: true, icpVersionId: mine.version.id });
  });

  it('approve archives the previous published version of that profile', async () => {
    const base = await customIcp('s1', 'published');
    const next = await db(() =>
      prisma.icpVersion.create({
        data: { tenantId, icpProfileId: base.profile.id, versionNumber: 2, status: 'pending_review', rulesJson: rules('CTO') as never, submittedById: ids.s1, submittedAt: new Date() },
      }),
    );
    signInAs(actors.tl1);
    expect((await approve(next.id)).status).toBe(200);
    expect((await reload(base.version.id)).status).toBe('archived');
    expect((await reload(next.id)).status).toBe('published');
    // A second approve is a conflict, not a second archive.
    expect((await approve(next.id)).status).toBe(409);
  });

  it('reject needs a note, returns the version to draft and keeps the reason; the rep can resubmit', async () => {
    const mine = await customIcp('s1', 'pending_review');
    signInAs(actors.tl1);
    expect((await reject(mine.version.id, '')).status).toBe(400);
    signInAs(actors.tl2);
    expect((await reject(mine.version.id, 'Too broad')).status).toBe(404);
    signInAs(actors.tl1);
    expect((await reject(mine.version.id, 'Too broad: add a country')).status).toBe(200);
    const rejected = await reload(mine.version.id);
    expect(rejected).toMatchObject({ status: 'draft', reviewNote: 'Too broad: add a country', reviewedById: ids.tl1 });
    expect(await auditActions(mine.version.id)).toContain('admin.icp.reject');

    signInAs(actors.s1);
    const again = await publish(mine.version.id, rejected.updatedAt);
    expect((await again.json()).outcome).toBe('submitted');
    expect((await reload(mine.version.id)).reviewNote).toBeNull();
  });

  it('the submitter can withdraw; nobody else can', async () => {
    const mine = await customIcp('s1', 'pending_review');
    signInAs(actors.s3);
    expect((await postWithdraw(jsonReq('http://t/x', 'POST'), ctx(mine.version.id))).status).toBe(404);
    signInAs(actors.s1);
    expect((await postWithdraw(jsonReq('http://t/x', 'POST'), ctx(mine.version.id))).status).toBe(200);
    expect(await reload(mine.version.id)).toMatchObject({ status: 'draft', submittedById: null });
    expect(await auditActions(mine.version.id)).toContain('admin.icp.withdraw');
  });

  it('a team lead or manager publishing their own custom ICP needs no review', async () => {
    for (const key of ['tl1', 'fm']) {
      const mine = await customIcp(key, 'draft');
      signInAs(actors[key]);
      const res = await publish(mine.version.id, mine.version.updatedAt);
      expect((await res.json()).outcome).toBe('published');
      expect((await reload(mine.version.id)).status).toBe('published');
    }
  });

  it("a manager cannot publish another user's custom draft (they review a submission instead)", async () => {
    const mine = await customIcp('s1', 'draft');
    signInAs(actors.dir);
    expect((await publish(mine.version.id, mine.version.updatedAt)).status).toBe(403);
  });

  it('the review item shows a plain-language diff against the current published rules', async () => {
    const base = await customIcp('s1', 'published');
    await db(() =>
      prisma.icpVersion.create({
        data: { tenantId, icpProfileId: base.profile.id, versionNumber: 2, status: 'pending_review', rulesJson: rules('CTO') as never, submittedById: ids.s1, submittedAt: new Date() },
      }),
    );
    signInAs(actors.tl1);
    const queue = await (await getReviews(new NextRequest('http://t/api/icp/reviews'))).json();
    const item = queue.reviews.find((r: { profile: { id: string } }) => r.profile.id === base.profile.id);
    expect(item.changes).toEqual([{ label: 'Accepted buyer titles', before: 'CEO', after: 'CTO' }]);
    expect(item.currentPublishedVersion).toBe(1);
  });
});

/** The shared client id, as a function so it reads naturally inside object literals. */
function ivs() {
  return ids.client;
}

describe('attaching an ICP to a campaign', () => {
  it('reps attach a library ICP or their own approved ICP, not another rep\'s', async () => {
    const lib = await libraryIcp();
    const mine = await customIcp('s1', 'published');
    const theirs = await customIcp('s3', 'published');
    signInAs(actors.s1);
    expect((await assign(ids.c1, lib.version.id)).status).toBe(200);
    // Now the campaign has an ICP: replacing it is not a rep's call (it scores every rep's leads).
    const blocked = await assign(ids.c1, mine.version.id);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe('icp_already_set');
    await db(() => prisma.campaign.update({ where: { id: ids.c1 }, data: { icpProfileId: null, icpVersionId: null } }));
    expect((await assign(ids.c1, theirs.version.id)).status).toBe(404);
    expect((await assign(ids.c1, mine.version.id)).status).toBe(200);
    expect(await db(() => prisma.campaign.findUniqueOrThrow({ where: { id: ids.c1 } }))).toMatchObject({ icpProfileId: mine.profile.id });
    expect(await auditActions(ids.c1)).toContain('admin.campaign.icp_assign');
  });

  it('a rep cannot touch a campaign they are not on, or clear its ICP', async () => {
    const lib = await libraryIcp();
    signInAs(actors.s2);
    expect((await assign(ids.c1, lib.version.id)).status).toBe(404);
    signInAs(actors.s1);
    expect((await assign(ids.c1, null)).status).toBe(403);
  });

  it('a team lead attaches any ICP in their chain and can clear the ICP', async () => {
    const theirs = await customIcp('s3', 'published');
    const outside = await customIcp('s2', 'published');
    signInAs(actors.tl1);
    expect((await assign(ids.c1, theirs.version.id)).status).toBe(200);
    expect((await assign(ids.c1, outside.version.id)).status).toBe(404);
    const cleared = await assign(ids.c1, null);
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).note).toMatch(/not scored/);
    expect(await auditActions(ids.c1)).toContain('admin.campaign.icp_clear');
    expect(await db(() => prisma.campaign.findUniqueOrThrow({ where: { id: ids.c1 } }))).toMatchObject({ icpProfileId: null });
  });

  it('refuses a draft and an unknown version', async () => {
    const draft = await customIcp('s1', 'draft');
    signInAs(actors.s1);
    expect((await assign(ids.c1, draft.version.id)).status).toBe(409);
    expect((await assign(ids.c1, 'nope')).status).toBe(404);
  });
});

describe('preview', () => {
  it("previews a rep's own draft on the campaign's leads they can see, and nothing else", async () => {
    const mine = await customIcp('s1', 'draft');
    await db(async () => {
      for (const [owner, n] of [['s1', 2], ['s3', 3]] as const) {
        for (let i = 0; i < n; i += 1) {
          await prisma.lead.create({
            data: { tenantId, firstName: 'L', lastName: `${owner}${i}`, company: `Co ${randomUUID().slice(0, 5)}`, title: 'CEO', email: `${randomUUID()}@co.test`, assignedToId: ids[owner], campaignId: ids.c1 },
          });
        }
      }
    });
    signInAs(actors.s1);
    const ok = await postPreview(jsonReq('http://t/x', 'POST', { rulesJson: rules(), campaignId: ids.c1 }), ctx(mine.version.id));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.scope).toBe('campaign');
    expect(body.sampleSize).toBe(2);

    const hidden = await postPreview(jsonReq('http://t/x', 'POST', { rulesJson: rules(), campaignId: ids.c2 }), ctx(mine.version.id));
    expect(hidden.status).toBe(404);
  });

  it('an SDR cannot preview a library ICP they cannot edit; a team lead can', async () => {
    const lib = await libraryIcp();
    signInAs(actors.s1);
    expect((await postPreview(jsonReq('http://t/x', 'POST', { rulesJson: rules() }), ctx(lib.version.id))).status).toBe(403);
    signInAs(actors.tl1);
    expect((await postPreview(jsonReq('http://t/x', 'POST', { rulesJson: rules() }), ctx(lib.version.id))).status).toBe(200);
  });
});

describe('tenant isolation', () => {
  it('another tenant cannot see, edit, approve or attach this tenant\'s ICPs', async () => {
    const pending = await customIcp('s1', 'pending_review');
    const otherDirector = await prisma.user.create({
      data: { tenantId: otherTenantId, email: `od.${randomUUID()}@t.test`, firstName: 'O', lastName: 'D', role: 'director', password: 'x', isActive: true },
    });
    signInAs({ id: otherDirector.id, role: 'director', tenantId: otherTenantId });
    const listed = (await (await getProfiles()).json()).profiles.map((p: { id: string }) => p.id);
    expect(listed).not.toContain(pending.profile.id);
    expect((await approve(pending.version.id)).status).toBe(404);
    expect((await save(pending.version.id, pending.version.updatedAt)).status).toBe(404);
    expect((await assign(ids.c1, pending.version.id)).status).toBe(404);
    const queue = await (await getReviews(new NextRequest('http://t/api/icp/reviews'))).json();
    expect(queue.reviews).toEqual([]);
    expect((await reload(pending.version.id)).status).toBe('pending_review');
  });
});

describe('API keys', () => {
  async function keyFor(userKey: string, scopes: string[]) {
    const token = `tl_live_${crypto.randomBytes(24).toString('hex')}`;
    await db(() =>
      prisma.apiKey.create({
        data: {
          tenantId,
          name: 'k',
          keyPrefix: token.slice(0, 14),
          keyHash: crypto.createHash('sha256').update(token).digest('hex'),
          scopes,
          createdById: ids[userKey],
        },
      }),
    );
    requestHeaders = new Headers({ authorization: `Bearer ${token}` });
  }

  it('needs scoring:write for any ICP route, whatever the owner\'s role', async () => {
    await keyFor('fm', ['leads:read']);
    expect((await createProfile({ kind: 'library', name: `K ${randomUUID()}` })).status).toBe(403);
    expect((await getProfiles()).status).toBe(403);

    await keyFor('fm', ['scoring:write']);
    expect((await createProfile({ kind: 'library', name: `K ${randomUUID()}` })).status).toBe(201);
  });

  it("a key does not widen the owner: an SDR's scoring key still cannot make a library ICP or approve", async () => {
    await keyFor('s1', ['scoring:write']);
    expect((await createProfile({ kind: 'library', name: `K ${randomUUID()}` })).status).toBe(403);
    const pending = await customIcp('s1', 'pending_review');
    expect((await approve(pending.version.id)).status).toBe(403);
  });

  it('a team lead\'s key without scoring:write cannot review', async () => {
    await keyFor('tl1', ['leads:read']);
    expect((await getReviews(new NextRequest('http://t/api/icp/reviews'))).status).toBe(403);
  });
});

describe('creating a campaign requires an ICP', () => {
  const create = (body: Record<string, unknown>) =>
    postCampaign(jsonReq('http://t/api/campaigns', 'POST', { name: `New ${randomUUID().slice(0, 6)}`, clientId: ids.client, ...body }));

  it('is a 400 without one', async () => {
    signInAs(actors.tl1);
    const res = await create({});
    expect(res.status).toBe(400);
  });

  it('with a shared ICP: the campaign follows it and is scored right away', async () => {
    const lib = await libraryIcp();
    signInAs(actors.tl1);
    const res = await create({ icp: { mode: 'library', icpVersionId: lib.version.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.icpProfileId).toBe(lib.profile.id);
    expect(body.icp).toMatchObject({ mode: 'library', scored: true });
    expect((await db(() => resolveCampaignIcp(tenantId, body.id))).ok).toBe(true);
  });

  it('with a custom ICP: creates the profile and draft, and the campaign is unscored until it is live', async () => {
    signInAs(actors.tl1);
    const res = await create({ icp: { mode: 'custom', source: 'blank' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.icp).toMatchObject({ mode: 'custom', scored: false, publishMode: 'publish' });
    const profile = await db(() => prisma.icpProfile.findUniqueOrThrow({ where: { id: body.icp.profileId }, include: { versions: true } }));
    expect(profile).toMatchObject({ kind: 'custom', ownerUserId: ids.tl1 });
    expect(profile.versions.map((v) => v.status)).toEqual(['draft']);
    expect((await db(() => resolveCampaignIcp(tenantId, body.id))).ok).toBe(false);
  });

  it('refuses a custom profile, a draft, or an unknown version in the shared slot, and writes nothing', async () => {
    const mine = await customIcp('tl1', 'published');
    signInAs(actors.tl1);
    const name = `Orphan ${randomUUID().slice(0, 6)}`;
    for (const icpVersionId of [mine.version.id, 'missing']) {
      const res = await postCampaign(
        jsonReq('http://t/api/campaigns', 'POST', { name, newClientName: name, icp: { mode: 'library', icpVersionId } }),
      );
      expect(res.status).toBe(400);
    }
    expect(await db(() => prisma.client.count({ where: { tenantId, name } }))).toBe(0);
  });

  it('a template or copy needs its source named', async () => {
    signInAs(actors.tl1);
    expect((await create({ icp: { mode: 'custom', source: 'template' } })).status).toBe(400);
    expect((await create({ icp: { mode: 'custom', source: 'library' } })).status).toBe(400);
  });
});

describe('rescore after approval', () => {
  it('an approved ICP changes the verdicts of its campaign\'s leads', async () => {
    const mine = await customIcp('s1', 'pending_review');
    const campaign = await db(() => prisma.campaign.create({ data: { tenantId, clientId: ids.client, name: `R ${randomUUID()}`, startDate: new Date(), icpProfileId: mine.profile.id } }));
    await db(() => prisma.campaignSdr.create({ data: { tenantId, campaignId: campaign.id, userId: ids.tl1 } }));
    const lead = await db(() =>
      prisma.lead.create({
        data: { tenantId, firstName: 'A', lastName: 'B', company: `Acme ${randomUUID().slice(0, 5)}`, title: 'CEO', email: `${randomUUID()}@acme.test`, assignedToId: ids.s1, campaignId: campaign.id },
      }),
    );
    signInAs(actors.tl1);
    const rescore = () => postRescore(jsonReq('http://t/api/leads/rescore-icp', 'POST', { campaignId: campaign.id, onlyUnscored: false }));
    await rescore();
    expect((await db(() => prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }))).icpQualification).toBeNull();

    await approve(mine.version.id);
    expect((await rescore()).status).toBe(200);
    const scored = await db(() => prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }));
    expect(scored.icpQualification).not.toBeNull();
    expect(scored.icpVersionId).toBe(mine.version.id);
  });
});

describe('security review follow-ups', () => {
  it('H1: a rep cannot repoint a campaign that has an ICP; a team lead can; a rep can set the first one', async () => {
    const lib = await libraryIcp();
    const other = await libraryIcp();
    signInAs(actors.s1);
    expect((await assign(ids.c1, lib.version.id)).status).toBe(200);
    signInAs(actors.s3);
    const res = await assign(ids.c1, other.version.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('icp_already_set');
    expect(await db(() => prisma.campaign.findUniqueOrThrow({ where: { id: ids.c1 } }))).toMatchObject({ icpProfileId: lib.profile.id });
    signInAs(actors.tl1);
    expect((await assign(ids.c1, other.version.id)).status).toBe(200);
  });

  it('M1: an approval is bound to the submission the reviewer saw (withdraw, edit, resubmit swap)', async () => {
    const mine = await customIcp('s1', 'pending_review');
    signInAs(actors.tl1);
    const seen = await submittedAtOf(mine.version.id);
    expect((await postApprove(jsonReq('http://t/x', 'POST', {}), ctx(mine.version.id))).status).toBe(400);

    // The rep swaps the rules under the reviewer.
    await new Promise((resolve) => setTimeout(resolve, 15));
    signInAs(actors.s1);
    expect((await postWithdraw(jsonReq('http://t/x', 'POST'), ctx(mine.version.id))).status).toBe(200);
    const draft = await reload(mine.version.id);
    expect((await save(mine.version.id, draft.updatedAt, rules('Intern'))).status).toBe(200);
    expect((await publish(mine.version.id, (await reload(mine.version.id)).updatedAt)).status).toBe(200);

    signInAs(actors.tl1);
    const stale = await approve(mine.version.id, seen);
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('changed_since_opened');
    expect((await reject(mine.version.id, 'Not that one', seen)).status).toBe(409);
    expect((await reload(mine.version.id)).status).toBe('pending_review');
    expect((await approve(mine.version.id)).status).toBe(200);
  });

  it('M2: a viewer who cannot edit a profile sees only its published versions', async () => {
    const lib = await libraryIcp();
    await db(() => prisma.icpVersion.create({ data: { tenantId, icpProfileId: lib.profile.id, versionNumber: 2, status: 'draft', rulesJson: rules('SECRET-DRAFT') as never } }));
    const s2Pending = await customIcp('s2', 'pending_review');
    const versionsOf = async (actor: Actor, profileId: string) => {
      signInAs(actor);
      const body = await (await getProfiles()).json();
      return body.profiles.find((p: { id: string }) => p.id === profileId)?.versions.map((v: { status: string }) => v.status) as string[] | undefined;
    };
    expect(await versionsOf(actors.s1, lib.profile.id)).toEqual(['published']);
    expect(await versionsOf(actors.tl1, lib.profile.id)).toEqual(['published']);
    expect(await versionsOf(actors.dir, lib.profile.id)).toEqual(['draft', 'published']);
    // The owner sees their own pending version; the team lead above them sees only what is live.
    expect(await versionsOf(actors.s2, s2Pending.profile.id)).toEqual(['pending_review']);
    expect(await versionsOf(actors.tl2, s2Pending.profile.id)).toEqual([]);
    signInAs(actors.s1);
    expect(JSON.stringify(await (await getProfiles()).json())).not.toContain('SECRET-DRAFT');
  });

  it("M3: research and the version picker only take library ICPs or ones in the caller's chain", async () => {
    const lib = await libraryIcp();
    const inChain = await customIcp('s1', 'published');
    const outside = await customIcp('s2', 'published');
    const draft = await customIcp('s1', 'draft');
    const preview = (versionId: string) =>
      postResearchPreview(jsonReq('http://t/api/research/preview', 'POST', { kind: 'company', icpVersionId: versionId, queryLimit: 10 }));
    signInAs(actors.tl1);
    for (const hidden of [outside.version.id, draft.version.id, 'nope']) {
      const res = await preview(hidden);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/not found/);
    }
    for (const allowed of [lib.version.id, inChain.version.id]) {
      // Past the ICP check: it may still fail on its own terms (these rules build no queries).
      const res = await preview(allowed);
      expect(JSON.stringify(await res.json())).not.toMatch(/ICP version not found/);
    }
    const run = await postResearchRun(jsonReq('http://t/api/research/runs', 'POST', { kind: 'company', icpVersionId: outside.version.id }));
    expect(run.status).toBe(400);

    const picker = async (actor: Actor) => {
      signInAs(actor);
      return ((await (await getPublishedVersions()).json()).versions as Array<{ id: string }>).map((v) => v.id);
    };
    expect(await picker(actors.tl1)).toContain(inChain.version.id);
    expect(await picker(actors.tl1)).not.toContain(outside.version.id);
    expect(await picker(actors.tl1)).toContain(lib.version.id);
    expect(await picker(actors.dir)).toContain(outside.version.id);
  });

  it('M4: rule lists and bodies are bounded; the largest real list still saves', async () => {
    const mine = await customIcp('s1', 'draft');
    signInAs(actors.s1);
    const tooMany = rules();
    tooMany.persona.titleAllowlist = Array.from({ length: 201 }, (_, i) => `Title ${i}`);
    expect((await save(mine.version.id, mine.version.updatedAt, tooMany)).status).toBe(400);
    const tooLong = rules('x'.repeat(201));
    expect((await save(mine.version.id, mine.version.updatedAt, tooLong)).status).toBe(400);
    const realistic = rules();
    realistic.persona.titleAllowlist = Array.from({ length: 25 }, (_, i) => `Head of Department ${i}`);
    expect((await save(mine.version.id, mine.version.updatedAt, realistic)).status).toBe(200);

    const fresh = await reload(mine.version.id);
    const huge = await patchVersion(
      new NextRequest('http://t/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedUpdatedAt: fresh.updatedAt.toISOString(), rulesJson: rules(), pad: 'y'.repeat(70 * 1024) }) }),
      ctx(mine.version.id),
    );
    expect(huge.status).toBe(413);
    const hugePreview = await postPreview(
      new NextRequest('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rulesJson: rules(), pad: 'y'.repeat(70 * 1024) }) }),
      ctx(mine.version.id),
    );
    expect(hugePreview.status).toBe(413);
  });

  it('M4: preview, draft saves and custom ICP creation are rate limited per user', async () => {
    const mine = await customIcp('s1', 'draft');
    signInAs(actors.s1);
    limiter.deny.add('icp-preview');
    expect((await postPreview(jsonReq('http://t/x', 'POST', { rulesJson: rules() }), ctx(mine.version.id))).status).toBe(429);
    limiter.deny.add('icp-save');
    const saved = await save(mine.version.id, mine.version.updatedAt);
    expect(saved.status).toBe(429);
    expect(saved.headers.get('retry-after')).toBe('30');
    limiter.deny.add('icp-create-custom');
    expect((await createProfile({ campaignId: ids.c1 })).status).toBe(429);
    signInAs(actors.tl1);
    const lib = await libraryIcp();
    const campaignRes = await postCampaign(jsonReq('http://t/api/campaigns', 'POST', { name: `RL ${randomUUID().slice(0, 5)}`, clientId: ids.client, icp: { mode: 'custom', source: 'blank' } }));
    expect(campaignRes.status).toBe(429);
    // The shared-ICP path is not a custom creation and is unaffected.
    const ok = await postCampaign(jsonReq('http://t/api/campaigns', 'POST', { name: `RL ${randomUUID().slice(0, 5)}`, clientId: ids.client, icp: { mode: 'library', icpVersionId: lib.version.id } }));
    expect(ok.status).toBe(201);
  });

  it('M5: a failure after the campaign exists never deletes the custom ICP it points at', async () => {
    signInAs(actors.tl1);
    const spy = vi.spyOn(prisma.campaignSdr, 'upsert').mockRejectedValueOnce(new Error('boom after create'));
    const name = `Post-create ${randomUUID().slice(0, 6)}`;
    const res = await postCampaign(jsonReq('http://t/api/campaigns', 'POST', { name, clientId: ids.client, icp: { mode: 'custom', source: 'blank' } }));
    spy.mockRestore();
    expect(res.status).toBeGreaterThanOrEqual(500);
    const campaign = await db(() => prisma.campaign.findFirst({ where: { tenantId, name } }));
    expect(campaign?.icpProfileId).toBeTruthy();
    const profile = await db(() => prisma.icpProfile.findFirst({ where: { id: campaign!.icpProfileId! }, include: { versions: true } }));
    expect(profile?.versions).toHaveLength(1);
  });

  it('M5: when the campaign row itself is not created, the orphan custom ICP is removed', async () => {
    signInAs(actors.tl1);
    const before = await db(() => prisma.icpProfile.count({ where: { tenantId, kind: 'custom' } }));
    const spy = vi.spyOn(prisma.campaign, 'create').mockRejectedValueOnce(new Error('boom on create'));
    const res = await postCampaign(jsonReq('http://t/api/campaigns', 'POST', { name: `No row ${randomUUID().slice(0, 6)}`, clientId: ids.client, icp: { mode: 'custom', source: 'blank' } }));
    spy.mockRestore();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await db(() => prisma.icpProfile.count({ where: { tenantId, kind: 'custom' } }))).toBe(before);
  });

  it('L1: someone outside the chain gets the same 404 for a pending and a decided version', async () => {
    const decided = await customIcp('s1', 'published', { submittedById: ids.s1, submittedAt: new Date() });
    const pending = await customIcp('s1', 'pending_review');
    signInAs(actors.tl2);
    expect((await approve(decided.version.id)).status).toBe(404);
    expect((await approve(pending.version.id)).status).toBe(404);
    expect((await reject(decided.version.id, 'nope')).status).toBe(404);
    signInAs(actors.tl1);
    expect((await approve(decided.version.id)).status).toBe(409);
  });

  it('L2: creating a campaign with an API key needs scoring:write', async () => {
    const lib = await libraryIcp();
    const token = `tl_live_${crypto.randomBytes(24).toString('hex')}`;
    await db(() =>
      prisma.apiKey.create({
        data: { tenantId, name: 'k', keyPrefix: token.slice(0, 14), keyHash: crypto.createHash('sha256').update(token).digest('hex'), scopes: ['leads:read'], createdById: ids.tl1 },
      }),
    );
    requestHeaders = new Headers({ authorization: `Bearer ${token}` });
    const res = await postCampaign(jsonReq('http://t/api/campaigns', 'POST', { name: `Key ${randomUUID().slice(0, 5)}`, clientId: ids.client, icp: { mode: 'library', icpVersionId: lib.version.id } }));
    expect(res.status).toBe(403);
  });

  it('L3: draft saves and edits are audited, and an approval records the version it archived', async () => {
    const base = await customIcp('s1', 'published');
    signInAs(actors.s1);
    const clone = await postClone(jsonReq('http://t/x', 'POST', { sourceVersionId: base.version.id }));
    expect(clone.status).toBe(201);
    const draft = (await clone.json()).version;
    expect(await auditActions(draft.id)).toContain('admin.icp.start_edit');
    expect((await save(draft.id, new Date(draft.updatedAt), rules('CTO'))).status).toBe(200);
    expect(await auditActions(draft.id)).toContain('admin.icp.save_draft');
    expect((await publish(draft.id, (await reload(draft.id)).updatedAt)).status).toBe(200);
    signInAs(actors.tl1);
    expect((await approve(draft.id)).status).toBe(200);
    const row = await db(() => prisma.auditLog.findFirst({ where: { recordId: draft.id, action: 'admin.icp.approve' } }));
    expect((row?.changedFields as { archivedVersionIds?: string[] }).archivedVersionIds).toEqual([base.version.id]);
  });

  it('L4: the database allows one published version per profile', async () => {
    const lib = await libraryIcp();
    await expect(
      db(() => prisma.icpVersion.create({ data: { tenantId, icpProfileId: lib.profile.id, versionNumber: 2, status: 'published', rulesJson: rules() as never } })),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
