import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A rep's verdict on a lead's ICP fit (owner request, 2026-10-06), against a real database and
 * through the real session path. The verdict wins wherever qualification is read; the score
 * keeps moving underneath it and is never allowed to overwrite it.
 */

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; tenantId: string; authVersion: number } } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { clearVisibleUserCache } from '@/lib/auth';
import { rescoreLeadsIcp, scoreLeadIcp } from '@/lib/leads/icpScoring';
import { buildLeadListWhere } from '@/lib/leads/listQuery';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { DELETE, POST } from '@/app/api/leads/[id]/qualification/route';
import { createTestTenant } from './helpers/testTenant';

const RULES = (() => {
  const rules = emptyIcpRulesV2('review-rules', 'Review ICP');
  rules.persona = { ...rules.persona, titleTiers: [{ tier: 1, titles: ['ceo', 'founder'], keywords: [], weight: 100 }] };
  return rules;
})();

let tenantId: string;
let otherTenantId: string;
const ids = { owner: '', peer: '', other: '', campaign: '', lead: '', otherLead: '' };
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function user(t: string, role: 'sdr' | 'team_lead') {
  return inTenant(async () => (await prisma.user.create({ data: { tenantId: t, email: `${role}.${randomUUID()}@t.test`, firstName: 'U', lastName: role, password: 'x', role } })).id, t);
}

async function campaign(t: string) {
  return inTenant(async () => {
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'Software', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    const profile = await prisma.icpProfile.create({ data: { tenantId: t, name: 'Review ICP' } });
    const version = await prisma.icpVersion.create({ data: { tenantId: t, icpProfileId: profile.id, versionNumber: 1, status: 'published', rulesJson: RULES as never } });
    return (await prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name: 'Out', startDate: new Date(), icpVersionId: version.id } })).id;
  }, t);
}

async function lead(t: string, campaignId: string, assignedToId: string, title = 'CEO') {
  return inTenant(
    async () =>
      (
        await prisma.lead.create({
          data: { tenantId: t, firstName: 'Ann', lastName: 'L', email: `a.${randomUUID()}@acme.test`, company: `Acme ${randomUUID().slice(0, 5)}`, title, campaignId, assignedToId },
        })
      ).id,
    t
  );
}

const as = (userId: string, t = tenantId) => {
  clearVisibleUserCache();
  session.current = { user: { id: userId, tenantId: t, authVersion: 1 } };
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const review = (leadId: string, body: unknown) =>
  POST(new NextRequest(`http://localhost/api/leads/${leadId}/qualification`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), ctx(leadId));
const clear = (leadId: string) => DELETE(new NextRequest(`http://localhost/api/leads/${leadId}/qualification`, { method: 'DELETE' }), ctx(leadId));
const row = (id: string) => inTenant(() => prisma.lead.findUniqueOrThrow({ where: { id } }));
const reviews = (leadId: string) => inTenant(() => prisma.leadQualificationReview.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }));

beforeEach(async () => {
  tenantId = `t-qreview-${randomUUID()}`;
  otherTenantId = `t-qreview-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'Qualification review');
  await createTestTenant(otherTenantId, 'Qualification review other');
  ids.owner = await user(tenantId, 'sdr');
  ids.peer = await user(tenantId, 'sdr');
  ids.other = await user(otherTenantId, 'sdr');
  ids.campaign = await campaign(tenantId);
  ids.lead = await lead(tenantId, ids.campaign, ids.owner);
  ids.otherLead = await lead(otherTenantId, await campaign(otherTenantId), ids.other);
  await inTenant(() => scoreLeadIcp({ tenantId, leadId: ids.lead }));
});

describe('POST /api/leads/[id]/qualification', () => {
  it('records the owner’s verdict: review row with the score at the time, the mirror, a timeline line', async () => {
    const before = await row(ids.lead);
    expect(before.icpQualification).not.toBeNull();

    as(ids.owner);
    const res = await review(ids.lead, { verdict: 'unqualified', reasonCode: 'wrong_person', note: 'Left the company in 2025' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ qualificationOverride: 'unqualified', effective: { value: 'unqualified', source: 'human' } });

    const after = await row(ids.lead);
    expect(after).toMatchObject({ qualificationOverride: 'unqualified', qualificationOverrideById: ids.owner, icpQualification: before.icpQualification });
    const [r] = await reviews(ids.lead);
    expect(r).toMatchObject({ verdict: 'unqualified', reasonCode: 'wrong_person', note: 'Left the company in 2025', reviewedById: ids.owner, computedQualification: before.icpQualification, computedFitScore: before.icpFitScore });
    expect(after.latestQualificationReviewId).toBe(r.id);
    const activity = await inTenant(() => prisma.activity.findFirst({ where: { leadId: ids.lead, type: 'qualification_reviewed' } }));
    expect(activity?.description).toMatch(/^Marked Not a fit after review — Not the right person/);
    expect(JSON.stringify(activity?.metadata)).not.toContain('Left the company');
  });

  it('refuses another SDR’s lead and a lead in another tenant', async () => {
    as(ids.peer);
    expect((await review(ids.lead, { verdict: 'qualified', reasonCode: 'decision_maker_confirmed' })).status).toBe(403);
    as(ids.owner);
    expect((await review(ids.otherLead, { verdict: 'qualified', reasonCode: 'decision_maker_confirmed' })).status).toBe(404);
    expect(await reviews(ids.lead)).toHaveLength(0);
  });

  it('refuses a reason that does not fit the verdict, and "other" without a note', async () => {
    as(ids.owner);
    expect((await review(ids.lead, { verdict: 'qualified', reasonCode: 'too_small' })).status).toBe(400);
    expect((await review(ids.lead, { verdict: 'qualified', reasonCode: 'other' })).status).toBe(400);
    expect((await review(ids.lead, { verdict: 'qualified', reasonCode: 'other', note: 'Met at an event' })).status).toBe(200);
  });

  it('writes nothing when the same verdict and reason are sent again', async () => {
    as(ids.owner);
    await review(ids.lead, { verdict: 'qualified', reasonCode: 'decision_maker_confirmed' });
    await review(ids.lead, { verdict: 'qualified', reasonCode: 'decision_maker_confirmed' });
    expect(await reviews(ids.lead)).toHaveLength(1);
  });

  it('clears the verdict so the score applies again, keeping the history', async () => {
    as(ids.owner);
    await review(ids.lead, { verdict: 'qualified', reasonCode: 'decision_maker_confirmed' });
    const res = await clear(ids.lead);
    expect(res.status).toBe(200);
    expect((await row(ids.lead)).qualificationOverride).toBeNull();
    expect((await reviews(ids.lead)).map((r) => r.verdict)).toEqual(['qualified', null]);
  });
});

describe('the verdict wins where qualification is read', () => {
  it('is never overwritten by a rescore, which still moves the score underneath', async () => {
    as(ids.owner);
    await review(ids.lead, { verdict: 'qualified', reasonCode: 'decision_maker_confirmed' });
    await inTenant(() => prisma.lead.update({ where: { id: ids.lead }, data: { title: 'Intern' } }));
    await inTenant(() => scoreLeadIcp({ tenantId, leadId: ids.lead }));
    const after = await row(ids.lead);
    expect(after.qualificationOverride).toBe('qualified');
    expect(after.icpQualification).not.toBe('qualified');
  });

  it('filters leads by the verdict, and by the score only where nobody decided', async () => {
    const untouched = await lead(tenantId, ids.campaign, ids.owner);
    await inTenant(() => scoreLeadIcp({ tenantId, leadId: untouched }));
    const computed = (await row(untouched)).icpQualification!;
    as(ids.owner);
    const flipped = computed === 'unqualified' ? 'qualified' : 'unqualified';
    await review(ids.lead, { verdict: flipped, reasonCode: flipped === 'qualified' ? 'decision_maker_confirmed' : 'wrong_person' });

    const idsFor = async (q: 'qualified' | 'needs_review' | 'unqualified') =>
      (await inTenant(() => prisma.lead.findMany({ where: { AND: [{ tenantId }, buildLeadListWhere({}, { icpQualification: q })] }, select: { id: true } }))).map((l) => l.id);
    expect(await idsFor(flipped)).toContain(ids.lead);
    expect(await idsFor(computed)).toContain(untouched);
    expect(await idsFor(computed)).not.toContain(ids.lead);
  });

  it('counts reviewed leads as pinned in a rescore dry run, not as moves', async () => {
    as(ids.owner);
    await review(ids.lead, { verdict: 'unqualified', reasonCode: 'wrong_person' });
    const report = await inTenant(() => rescoreLeadsIcp({ tenantId, campaignId: ids.campaign, onlyUnscored: false, dryRun: true }));
    expect(report.pinned).toBe(1);
  });

  it('has no qualification reader left that skips the verdict', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    expect(read('lib/leads/listQuery.ts')).toContain('qualificationWhere(filters.icpQualification)');
    expect(read('lib/leadgen/summary.ts')).toContain("qualificationWhere('qualified')");
    expect(read('components/leads/LeadSignals.tsx')).toContain('effectiveQualification(lead)');
    expect(read('components/leads/IcpFitCard.tsx')).toContain('effectiveQualification(lead)');
  });
});
