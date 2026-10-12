/**
 * The ICP editor's error contract, against real Postgres and the real authorization path.
 *
 * Owner report 2026-10-13: "edit score" ended in a 404. A 404 must mean the version is truly missing
 * or invisible to the caller. A version that exists but is the wrong state for the action (archived,
 * published, in review) is a 409 with a sentence the editor can show, and one the caller may see but
 * not change is a 403.
 */
import { randomUUID } from 'node:crypto';

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
vi.mock('@/lib/security/attemptLimit', () => ({
  consumeAttempt: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: vi.fn() }),
}));

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { POST as postClone } from '@/app/api/icp/versions/route';
import { PATCH as patchVersion } from '@/app/api/icp/versions/[id]/route';
import { POST as postPreview } from '@/app/api/icp/versions/[id]/preview-score/route';
import { POST as postPublish } from '@/app/api/icp/versions/[id]/publish/route';

type Role = 'director' | 'sdr';
type Actor = { id: string; role: Role; tenantId: string };
type Status = 'draft' | 'pending_review' | 'published' | 'archived';

const tenantId = `t-icped-${randomUUID()}`;
const otherTenantId = `t-icped-other-${randomUUID()}`;
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

const jsonReq = (method: string, body?: unknown) =>
  new NextRequest('http://t/x', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeUser(key: string, role: Role) {
  const user = await prisma.user.create({
    data: { tenantId, email: `${key}.${randomUUID()}@t.test`, firstName: key, lastName: 'T', role, password: 'x', isActive: true },
  });
  actors[key] = { id: user.id, role, tenantId };
}

beforeAll(async () => {
  await prisma.tenant.createMany({ data: [{ id: tenantId, name: 'ICP editor' }, { id: otherTenantId, name: 'Other' }] });
  await db(async () => {
    await makeUser('dir', 'director');
    await makeUser('s1', 'sdr');
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

beforeEach(() => signInAs(null));

/** A shared ICP with one version per requested status, numbered in order. */
async function libraryWith(...statuses: Status[]) {
  return db(async () => {
    const profile = await prisma.icpProfile.create({ data: { tenantId, name: `Lib ${randomUUID().slice(0, 6)}`, kind: 'library' } });
    const versions = [];
    for (const [index, status] of statuses.entries()) {
      versions.push(
        await prisma.icpVersion.create({
          data: {
            tenantId,
            icpProfileId: profile.id,
            versionNumber: index + 1,
            status,
            rulesJson: rules() as never,
            ...(status === 'published' || status === 'archived' ? { publishedAt: new Date() } : {}),
            ...(status === 'pending_review' ? { submittedById: actors.s1.id, submittedAt: new Date() } : {}),
          },
        }),
      );
    }
    return { profile, versions };
  });
}

const save = (versionId: string, updatedAt: Date) =>
  patchVersion(jsonReq('PATCH', { expectedUpdatedAt: updatedAt.toISOString(), rulesJson: rules('CTO') }), ctx(versionId));
const clone = (sourceVersionId: string) => postClone(jsonReq('POST', { sourceVersionId }));
const publish = (versionId: string, updatedAt: Date) =>
  postPublish(jsonReq('POST', { expectedUpdatedAt: updatedAt.toISOString() }), ctx(versionId));
const preview = (versionId: string) => postPreview(jsonReq('POST', { rulesJson: rules('CTO') }), ctx(versionId));

describe('a director editing a shared ICP', () => {
  beforeEach(() => signInAs(actors.dir));

  it('walks clone, save, preview and publish without a 404', async () => {
    const { versions } = await libraryWith('published');
    const cloned = await clone(versions[0].id);
    expect(cloned.status).toBe(201);
    const draft = (await cloned.json()).version;
    expect(draft.status).toBe('draft');

    const saved = await save(draft.id, new Date(draft.updatedAt));
    expect(saved.status).toBe(200);
    expect((await preview(draft.id)).status).toBe(200);
    const fresh = (await saved.json()).version;
    const published = await publish(draft.id, new Date(fresh.updatedAt));
    expect(published.status).toBe(200);
    expect((await published.json()).outcome).toBe('published');
  });

  it('gets a 409 that names the problem when the version is not a draft', async () => {
    const { versions } = await libraryWith('archived', 'published');
    const [archived, published] = versions;

    const onPublished = await save(published.id, published.updatedAt);
    expect(onPublished.status).toBe(409);
    const publishedBody = await onPublished.json();
    expect(publishedBody.code).toBe('published_immutable');
    expect(publishedBody.error).toMatch(/Edit/);

    const onArchived = await save(archived.id, archived.updatedAt);
    expect(onArchived.status).toBe(409);
    const body = await onArchived.json();
    expect(body.code).toBe('not_a_draft');
    expect(body.error).toMatch(/replaced by a newer version/i);
  });

  it('gets a 409 when the version is waiting for review', async () => {
    const { versions } = await libraryWith('published', 'pending_review');
    const res = await save(versions[1].id, versions[1].updatedAt);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('review_pending');
  });

  it('cannot start an edit from an archived version (a stale tab): 409, and no draft is made', async () => {
    const { profile, versions } = await libraryWith('archived', 'published');
    const res = await clone(versions[0].id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('version_archived');
    const drafts = await db(() => prisma.icpVersion.count({ where: { icpProfileId: profile.id, status: 'draft' } }));
    expect(drafts).toBe(0);
  });

  it('publishing a version that is not a draft is a 409, not a 404', async () => {
    const { versions } = await libraryWith('archived', 'published');
    const res = await publish(versions[0].id, versions[0].updatedAt);
    expect(res.status).toBe(409);
  });

  it('still gets a 404 for a version that does not exist or belongs to another tenant', async () => {
    const foreignVersion = await tenantStorage.run({ tenantId: otherTenantId, bypassRls: true }, async () => {
      const foreign = await prisma.icpProfile.create({ data: { tenantId: otherTenantId, name: `F ${randomUUID().slice(0, 6)}`, kind: 'library' } });
      return prisma.icpVersion.create({
        data: { tenantId: otherTenantId, icpProfileId: foreign.id, versionNumber: 1, status: 'draft', rulesJson: rules() as never },
      });
    });
    for (const id of ['missing-version-id', foreignVersion.id]) {
      expect((await save(id, new Date())).status).toBe(404);
      expect((await clone(id)).status).toBe(404);
      expect((await preview(id)).status).toBe(404);
      expect((await publish(id, new Date())).status).toBe(404);
    }
  });
});

describe('a caller who may see an ICP but not change it', () => {
  it('gets a 403 with the reason, never a 404', async () => {
    const { versions } = await libraryWith('published');
    signInAs(actors.s1);
    const res = await clone(versions[0].id);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/library/i);
  });
});
