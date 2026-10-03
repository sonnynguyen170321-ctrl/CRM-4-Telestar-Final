import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import type { SessionUser } from '@/lib/auth';

/**
 * The scoring editor's live preview and the "Set as default" action, against the real database.
 *
 * The preview runs on every edit, so the property that matters most is that it writes nothing — no
 * assessment, no mirror on the lead, no audit row — and that it only ever samples the caller's own
 * tenant. "Set as default" moves the one default a tenant has, in one transaction.
 */

const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));

vi.mock('@/lib/auth', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    getVisibleCampaignIds: async () => null,
  };
});

import { prisma, tenantStorage } from '@/lib/prisma';
import { previewIcpRules } from '@/lib/leads/icpPreview';
import { POST as previewRoute } from '@/app/api/icp/versions/[id]/preview-score/route';
import { POST as defaultRoute } from '@/app/api/icp/profiles/[id]/default/route';

const T = 'icp-preview-tenant';
const OTHER = 'icp-preview-other';
const run = <R>(tenantId: string, fn: () => Promise<R>) => tenantStorage.run({ tenantId, bypassRls: true }, fn);

const ids = { manager: '', sdr: '', profile: '', version: '', draftProfile: '', otherVersion: '' };

function rules() {
  const value = emptyIcpRulesV2('preview', 'Preview');
  value.geography.targetCountries = ['United States'];
  value.persona.titleAllowlist = ['CEO'];
  value.pointRules = {
    enabled: true,
    fitAt: 40,
    reviewAt: 20,
    rules: [
      { id: 't', group: 'title', values: ['CEO'], points: 30 },
      { id: 'c', group: 'country', values: ['United States'], points: 20 },
    ],
  };
  return value;
}

async function seed() {
  for (const t of [T, OTHER]) {
    await run(t, async () => {
      await prisma.leadIcpAssessment.deleteMany({ where: { tenantId: t } });
      await prisma.lead.deleteMany({ where: { tenantId: t } });
      await prisma.account.deleteMany({ where: { tenantId: t } });
      await prisma.campaign.deleteMany({ where: { tenantId: t } });
      await prisma.icpVersion.deleteMany({ where: { tenantId: t } });
      await prisma.icpProfile.deleteMany({ where: { tenantId: t } });
      await prisma.client.deleteMany({ where: { tenantId: t } });
      await prisma.auditLog.deleteMany({ where: { userId: { in: [`${t}-manager`, `${t}-sdr`] } } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.deleteMany({ where: { id: t } });
      await prisma.tenant.create({ data: { id: t, name: t } });
    });
  }

  await run(T, async () => {
    const manager = await prisma.user.create({
      data: { id: `${T}-manager`, tenantId: T, email: 'mgr@preview.test', firstName: 'Mai', lastName: 'Le', role: 'director', password: 'x', isActive: true },
    });
    const sdr = await prisma.user.create({
      data: { id: `${T}-sdr`, tenantId: T, email: 'sdr@preview.test', firstName: 'Sam', lastName: 'Do', role: 'sdr', password: 'x', isActive: true },
    });
    const profile = await prisma.icpProfile.create({ data: { tenantId: T, name: 'Preview ICP', isDefault: true } });
    const version = await prisma.icpVersion.create({
      data: { tenantId: T, icpProfileId: profile.id, versionNumber: 1, status: 'published', rulesJson: rules() as never, publishedAt: new Date() },
    });
    const draftOnly = await prisma.icpProfile.create({ data: { tenantId: T, name: 'Draft-only ICP', isDefault: false } });
    await prisma.icpVersion.create({
      data: { tenantId: T, icpProfileId: draftOnly.id, versionNumber: 1, status: 'draft', rulesJson: rules() as never },
    });
    const client = await prisma.client.create({ data: { tenantId: T, name: 'Preview Client', industry: 'Software', contactName: 'c', contactEmail: 'c@preview.test' } });
    const campaign = await prisma.campaign.create({ data: { tenantId: T, clientId: client.id, name: 'Preview campaign', startDate: new Date(), icpVersionId: version.id } });
    const account = await prisma.account.create({ data: { tenantId: T, name: 'US Co', country: 'United States', industry: 'Software' } });
    await prisma.lead.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        tenantId: T,
        firstName: `Lead${i}`,
        lastName: 'Preview',
        company: 'US Co',
        title: i % 2 === 0 ? 'CEO' : 'Engineer',
        email: `lead${i}-${randomUUID().slice(0, 6)}@usco.test`,
        assignedToId: sdr.id,
        campaignId: campaign.id,
        accountId: account.id,
      })),
    });
    Object.assign(ids, { manager: manager.id, sdr: sdr.id, profile: profile.id, version: version.id, draftProfile: draftOnly.id });
  });

  await run(OTHER, async () => {
    const user = await prisma.user.create({
      data: { id: `${OTHER}-manager`, tenantId: OTHER, email: 'mgr@other.test', firstName: 'O', lastName: 'T', role: 'director', password: 'x', isActive: true },
    });
    const profile = await prisma.icpProfile.create({ data: { tenantId: OTHER, name: 'Other ICP', isDefault: true } });
    const version = await prisma.icpVersion.create({
      data: { tenantId: OTHER, icpProfileId: profile.id, versionNumber: 1, status: 'published', rulesJson: rules() as never },
    });
    const client = await prisma.client.create({ data: { tenantId: OTHER, name: 'Other Client', industry: 'Software', contactName: 'c', contactEmail: 'c@other.test' } });
    const campaign = await prisma.campaign.create({ data: { tenantId: OTHER, clientId: client.id, name: 'Other campaign', startDate: new Date() } });
    await prisma.lead.create({
      data: {
        tenantId: OTHER,
        firstName: 'Foreign',
        lastName: 'Lead',
        company: 'X',
        title: 'CEO',
        email: `f-${randomUUID().slice(0, 6)}@x.test`,
        assignedToId: user.id,
        campaignId: campaign.id,
      },
    });
    ids.otherVersion = version.id;
  });
}

function asUser(id: string, role: SessionUser['role']) {
  authUser.current = { id, email: `${id}@t.test`, firstName: 'A', lastName: 'B', role, tenantId: T } as SessionUser;
}

const post = (url: string, body?: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(seed);
beforeEach(() => {
  authUser.current = null;
});

describe('previewIcpRules', () => {
  it('scores the ICP\'s own campaign leads and writes nothing at all', async () => {
    const before = await run(T, async () => ({
      assessments: await prisma.leadIcpAssessment.count({ where: { tenantId: T } }),
      scoredLeads: await prisma.lead.count({ where: { tenantId: T, icpQualification: { not: null } } }),
    }));

    const result = await run(T, () => previewIcpRules({ tenantId: T, icpProfileId: ids.profile, rules: rules() }));

    expect(result.scope).toBe('icp_campaigns');
    expect(result.sampleSize).toBe(22);
    // CEO in the US: 30 + 20 = 50 ≥ 40. Engineer in the US: 20 = Review.
    expect(result.after.qualified).toBe(11);
    expect(result.after.needs_review).toBe(11);
    expect(result.examples.length).toBeGreaterThan(0);

    const after = await run(T, async () => ({
      assessments: await prisma.leadIcpAssessment.count({ where: { tenantId: T } }),
      scoredLeads: await prisma.lead.count({ where: { tenantId: T, icpQualification: { not: null } } }),
    }));
    expect(after).toEqual(before);
  });

  it('reports what would move, from the stored verdicts', async () => {
    const result = await run(T, () => previewIcpRules({ tenantId: T, icpProfileId: ids.profile, rules: rules() }));
    expect(result.before.unscored).toBe(22);
    expect(result.moves['unscored→qualified']).toBe(11);
  });

  it('never samples another tenant\'s leads', async () => {
    const result = await run(T, () => previewIcpRules({ tenantId: T, icpProfileId: ids.draftProfile, rules: rules() }));
    // No campaigns use this profile → widened to recent leads, still only this tenant's 22.
    expect(result.scope).toBe('recent_leads');
    expect(result.sampleSize).toBe(22);
    expect(result.examples.every((example) => example.company !== 'X')).toBe(true);
  });
});

describe('POST /api/icp/versions/[id]/preview-score', () => {
  const url = () => `http://localhost/api/icp/versions/${ids.version}/preview-score`;

  it('refuses an SDR', async () => {
    asUser(ids.sdr, 'sdr');
    const res = await previewRoute(post(url(), { rulesJson: rules() }), { params: Promise.resolve({ id: ids.version }) });
    expect(res.status).toBe(403);
  });

  it('previews for a manager', async () => {
    asUser(ids.manager, 'director');
    const res = await run(T, () =>
      previewRoute(post(url(), { rulesJson: rules() }), { params: Promise.resolve({ id: ids.version }) })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ sampleSize: 22 });
  });

  it('answers 400 for rules that would not save, instead of scoring them', async () => {
    asUser(ids.manager, 'director');
    const bad = rules();
    bad.pointRules!.fitAt = 10;
    const res = await run(T, () => previewRoute(post(url(), { rulesJson: bad }), { params: Promise.resolve({ id: ids.version }) }));
    expect(res.status).toBe(400);
  });

  it('answers 404 for another tenant\'s version', async () => {
    asUser(ids.manager, 'director');
    const res = await run(T, () =>
      previewRoute(post(`http://localhost/api/icp/versions/${ids.otherVersion}/preview-score`, { rulesJson: rules() }), {
        params: Promise.resolve({ id: ids.otherVersion }),
      })
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/icp/profiles/[id]/default', () => {
  it('refuses a profile with nothing published — it would score every unassigned lead as NOT SCORED', async () => {
    asUser(ids.manager, 'director');
    const res = await run(T, () => defaultRoute(post('http://localhost/x'), { params: Promise.resolve({ id: ids.draftProfile }) }));
    expect(res.status).toBe(409);
  });

  it('moves the one default and leaves exactly one', async () => {
    asUser(ids.manager, 'director');
    const second = await run(T, async () => {
      const profile = await prisma.icpProfile.create({ data: { tenantId: T, name: `Second ${randomUUID().slice(0, 4)}`, isDefault: false } });
      await prisma.icpVersion.create({
        data: { tenantId: T, icpProfileId: profile.id, versionNumber: 1, status: 'published', rulesJson: rules() as never },
      });
      return profile;
    });

    const res = await run(T, () => defaultRoute(post('http://localhost/x'), { params: Promise.resolve({ id: second.id }) }));
    expect(res.status).toBe(200);

    const defaults = await run(T, () => prisma.icpProfile.findMany({ where: { tenantId: T, isDefault: true }, select: { id: true } }));
    expect(defaults).toEqual([{ id: second.id }]);
    // The other tenant's default is untouched.
    const otherDefaults = await run(OTHER, () => prisma.icpProfile.count({ where: { tenantId: OTHER, isDefault: true } }));
    expect(otherDefaults).toBe(1);
  });

  it('refuses an SDR', async () => {
    asUser(ids.sdr, 'sdr');
    const res = await defaultRoute(post('http://localhost/x'), { params: Promise.resolve({ id: ids.profile }) });
    expect(res.status).toBe(403);
  });
});
