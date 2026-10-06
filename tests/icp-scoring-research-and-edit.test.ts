import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Two ways a lead's ICP verdict went stale or wrong (owner report, 2026-10-06), against a real
 * database: the scorer ignored the company research already on file, and editing a lead's title
 * or company never rescored it — the drawer kept showing a verdict about a person who was no
 * longer on the record.
 */

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; tenantId: string; authVersion: number } } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { clearVisibleUserCache } from '@/lib/auth';
import { loadScoringIntelligence, scoreLeadIcp } from '@/lib/leads/icpScoring';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { PUT } from '@/app/api/leads/[id]/route';
import { createTestTenant } from './helpers/testTenant';

const RULES = (() => {
  const rules = emptyIcpRulesV2('research-rules', 'Research ICP');
  rules.persona = { ...rules.persona, titleAllowlist: ['CEO', 'VP Sales'] };
  rules.geography = { ...rules.geography, targetCountries: ['USA'] };
  rules.companyType = { ...rules.companyType, servicesConsultingPolicy: { disqualify: true, exceptMarkets: [] } };
  rules.scorePolicy = { ...rules.scorePolicy, qualifiedMinFitScore: 75, needsReviewMinFitScore: 45 };
  return rules;
})();

let tenantId: string;
let otherTenantId: string;
const ids = { owner: '', lead: '', account: '', otherAccount: '' };
const inTenant = <T>(fn: () => Promise<T>, t = tenantId) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

async function setUpTenant(t: string) {
  return inTenant(async () => {
    const owner = await prisma.user.create({ data: { tenantId: t, email: `sdr.${randomUUID()}@t.test`, firstName: 'U', lastName: 'S', password: 'x', role: 'sdr' } });
    const client = await prisma.client.create({ data: { tenantId: t, name: 'C', industry: 'Software', contactName: 'c', contactEmail: `c.${randomUUID()}@t.test` } });
    const profile = await prisma.icpProfile.create({ data: { tenantId: t, name: 'Research ICP' } });
    const version = await prisma.icpVersion.create({ data: { tenantId: t, icpProfileId: profile.id, versionNumber: 1, status: 'published', rulesJson: RULES as never } });
    const campaign = await prisma.campaign.create({ data: { tenantId: t, clientId: client.id, name: 'Out', startDate: new Date(), icpVersionId: version.id } });
    const account = await prisma.account.create({ data: { tenantId: t, name: 'Acme', country: 'United States', industry: 'Software', website: 'https://acme.test' } });
    const lead = await prisma.lead.create({
      data: { tenantId: t, firstName: 'Ann', lastName: 'L', email: `a.${randomUUID()}@acme.test`, company: 'Acme', title: 'CEO', campaignId: campaign.id, assignedToId: owner.id, accountId: account.id },
    });
    return { owner: owner.id, lead: lead.id, account: account.id };
  }, t);
}

async function addResearch(t: string, accountId: string, status: 'extracted' | 'partial' | 'failed' | 'placeholder', summary: string, version = 1) {
  await inTenant(
    () =>
      prisma.companyIntelligenceProfile.create({
        data: { tenantId: t, accountId, profileStatus: status, companySummary: summary, factsJson: ['b2b'], researchVersion: version, idempotencyKey: randomUUID() },
      }),
    t
  );
}

const lead = () => inTenant(() => prisma.lead.findUniqueOrThrow({ where: { id: ids.lead } }));
const assessments = () => inTenant(() => prisma.leadIcpAssessment.findMany({ where: { leadId: ids.lead }, orderBy: { createdAt: 'asc' } }));
const score = () => inTenant(() => scoreLeadIcp({ tenantId, leadId: ids.lead }));

function put(body: unknown) {
  clearVisibleUserCache();
  session.current = { user: { id: ids.owner, tenantId, authVersion: 1 } };
  return PUT(
    new NextRequest(`http://localhost/api/leads/${ids.lead}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ id: ids.lead }) }
  );
}

beforeEach(async () => {
  tenantId = `t-icp-research-${randomUUID()}`;
  otherTenantId = `t-icp-research-other-${randomUUID()}`;
  await createTestTenant(tenantId, 'ICP research');
  await createTestTenant(otherTenantId, 'ICP research other');
  Object.assign(ids, await setUpTenant(tenantId));
  ids.otherAccount = (await setUpTenant(otherTenantId)).account;
});

describe('scoring reads the company research on file', () => {
  it('sends a lead to review once its research describes a consultancy', async () => {
    await score();
    expect(await lead()).toMatchObject({ icpQualification: 'qualified' });

    await addResearch(tenantId, ids.account, 'extracted', 'A management consulting firm for regional banks.');
    await score();
    expect(await lead()).toMatchObject({ icpQualification: 'needs_review' });
    const latest = (await assessments()).at(-1)!;
    expect(JSON.stringify(latest.inputSnapshot)).toContain('management consulting firm');
    expect(JSON.stringify(latest.evidenceJson)).toContain('services_review');
  });

  it('ignores research that failed or never ran', async () => {
    await addResearch(tenantId, ids.account, 'failed', 'A consulting firm.', 1);
    await addResearch(tenantId, ids.account, 'placeholder', 'A consulting firm.', 2);
    await score();
    expect(await lead()).toMatchObject({ icpQualification: 'qualified' });
  });

  it('uses the newest usable profile, and only the caller’s tenant', async () => {
    await addResearch(tenantId, ids.account, 'partial', 'Old: a consulting firm.', 1);
    await new Promise((r) => setTimeout(r, 5));
    await addResearch(tenantId, ids.account, 'extracted', 'New: a SaaS platform for retailers.', 2);
    await addResearch(otherTenantId, ids.otherAccount, 'extracted', 'Other tenant secret summary.');

    const found = await inTenant(() => loadScoringIntelligence(tenantId, [ids.account, ids.otherAccount, null, ids.account]));
    expect([...found.keys()]).toEqual([ids.account]);
    expect(found.get(ids.account)).toEqual({ industryCategory: null, summary: 'New: a SaaS platform for retailers.', facts: ['b2b'] });
  });
});

describe('PUT /api/leads/[id] rescores when what the score reads changes', () => {
  it('rescores on a title change', async () => {
    await score();
    expect(await lead()).toMatchObject({ icpQualification: 'qualified' });

    const res = await put({ title: 'Office Assistant' });
    expect(res.status).toBe(200);
    expect((await assessments()).length).toBe(2);
    expect((await lead()).icpQualification).not.toBe('qualified');
  });

  it('does not rescore when the form sends the same title back, or only other fields', async () => {
    await score();
    // Change the ICP underneath: any rescore now writes a second assessment, so a count of one
    // proves the save did not score.
    const version = await inTenant(() => prisma.icpVersion.findFirstOrThrow({ where: { tenantId } }));
    await inTenant(() => prisma.icpVersion.update({ where: { id: version.id }, data: { rulesJson: { ...RULES, persona: { ...RULES.persona, titleAllowlist: ['CTO'] } } as never } }));

    expect((await put({ firstName: 'Annie', title: 'CEO', company: 'Acme' })).status).toBe(200);
    expect((await assessments()).length).toBe(1);

    expect((await put({ title: 'Chief Executive Officer' })).status).toBe(200);
    expect((await assessments()).length).toBe(2);
  });
});
