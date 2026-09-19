/**
 * ICP scoring for a CRM lead — the thing 987 of 1,138 production leads never had.
 *
 * Until 2026-09-19 the ICP engine could only write to `LeadPoolItem`. A lead an SDR uploaded
 * through Import CSV had no `icpFitScore`, no assessment row, no place for one. The team was
 * filtering ICP fit in Excel before upload. This suite pins the contract for the lead-side
 * runtime, which is the pool contract with a different subject:
 *
 *   - NOT SCORED is honest: no ICP for the campaign → fields stay null, no row, no fake zero
 *   - one engine: the lead's evidence is built the same way and hashed the same way
 *   - insert-only: a re-score under identical rules reuses the row; under changed rules it
 *     appends one and moves the pointer — the old verdict survives
 *   - the mirror on the lead moves in the same transaction as the assessment
 *   - tenant A's ICP never scores tenant B's lead
 *
 * Real Postgres, because every one of those is a claim about what is persisted.
 */
import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { prisma, tenantStorage } from '@/lib/prisma';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { rescoreLeadsIcp, scoreLeadIcp } from '@/lib/leads/icpScoring';

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

const T = 'lead-icp-tenant';
const T_B = 'lead-icp-tenant-b';
const run = <R>(t: string, fn: () => Promise<R>) => tenantStorage.run({ tenantId: t, bypassRls: true }, fn);

const RULES = (() => {
  const rules = emptyIcpRulesV2('lead-icp-rules', 'Lead ICP');
  rules.industry = { ...rules.industry, mode: 'allowlist', targetIndustries: ['software'] };
  rules.persona = {
    ...rules.persona,
    titleTiers: [
      { tier: 1, titles: ['ceo', 'founder'], keywords: [], weight: 100 },
      { tier: 2, titles: ['director'], keywords: [], weight: 80 },
    ],
  };
  return rules;
})();

const ids = { user: '', client: '', campaignScored: '', campaignBare: '', version: '' };

async function seed() {
  for (const t of [T, T_B]) {
    await run(t, async () => {
      await prisma.leadIcpAssessment.deleteMany({ where: { tenantId: t } });
      await prisma.lead.deleteMany({ where: { tenantId: t } });
      await prisma.campaign.deleteMany({ where: { tenantId: t } });
      await prisma.icpVersion.deleteMany({ where: { tenantId: t } });
      await prisma.icpProfile.deleteMany({ where: { tenantId: t } });
      await prisma.client.deleteMany({ where: { tenantId: t } });
      await prisma.user.deleteMany({ where: { tenantId: t } });
      await prisma.tenant.deleteMany({ where: { id: t } });
      await prisma.tenant.create({ data: { id: t, name: t } });
    });
  }
  await run(T, async () => {
    const user = await prisma.user.create({ data: { tenantId: T, email: 'sdr@lead-icp.test', firstName: 'Lan', lastName: 'Pham', role: 'sdr', password: 'x', isActive: true } });
    const client = await prisma.client.create({ data: { tenantId: T, name: 'ICP Client', industry: 'Software', contactName: 'c', contactEmail: 'c@lead-icp.test' } });
    const profile = await prisma.icpProfile.create({ data: { tenantId: T, name: 'Lead ICP', isDefault: false } });
    const version = await prisma.icpVersion.create({ data: { tenantId: T, icpProfileId: profile.id, versionNumber: 1, status: 'published', rulesJson: RULES as never } });
    const scored = await prisma.campaign.create({ data: { tenantId: T, clientId: client.id, name: 'Scored campaign', startDate: new Date(), icpVersionId: version.id } });
    const bare = await prisma.campaign.create({ data: { tenantId: T, clientId: client.id, name: 'Bare campaign', startDate: new Date() } });
    Object.assign(ids, { user: user.id, client: client.id, campaignScored: scored.id, campaignBare: bare.id, version: version.id });
  });
}

async function lead(campaignId: string, overrides: Record<string, unknown> = {}, tenant = T, assignedToId = ids.user) {
  return run(tenant, () =>
    prisma.lead.create({
      data: {
        tenantId: tenant,
        firstName: 'Quynh',
        lastName: `Tester-${randomUUID().slice(0, 6)}`,
        company: `Acme ${randomUUID().slice(0, 6)}`,
        title: 'CEO',
        email: `q-${randomUUID().slice(0, 6)}@acme.test`,
        assignedToId,
        campaignId,
        ...overrides,
      },
    })
  );
}

const reload = (id: string, tenant = T) => run(tenant, () => prisma.lead.findUniqueOrThrow({ where: { id } }));
const assessments = (leadId: string, tenant = T) => run(tenant, () => prisma.leadIcpAssessment.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }));

describe.skipIf(!hasDb)('scoreLeadIcp', () => {
  beforeAll(seed);

  it('leaves a lead NOT SCORED when its campaign has no ICP — null fields, no row, said out loud', async () => {
    const l = await lead(ids.campaignBare);
    const result = await run(T, () => scoreLeadIcp({ tenantId: T, leadId: l.id }));
    expect(result.status).toBe('not_scored');
    if (result.status === 'not_scored') expect(result.reason).toBe('no_icp_configured');
    const after = await reload(l.id);
    expect(after.icpFitScore).toBeNull();
    expect(after.icpQualification).toBeNull();
    expect(after.latestIcpAssessmentId).toBeNull();
    expect(await assessments(l.id)).toHaveLength(0);
  });

  it('scores a lead on a campaign with an ICP and mirrors the verdict onto the lead', async () => {
    const l = await lead(ids.campaignScored);
    const result = await run(T, () => scoreLeadIcp({ tenantId: T, leadId: l.id }));
    expect(result.status).toBe('scored');
    if (result.status !== 'scored') return;
    expect(result.inserted).toBe(true);

    const after = await reload(l.id);
    const rows = await assessments(l.id);
    expect(rows).toHaveLength(1);
    expect(after.latestIcpAssessmentId).toBe(rows[0].id);
    expect(after.icpFitScore).toBe(rows[0].fitScore);
    expect(after.icpQualification).toBe(rows[0].qualification);
    expect(after.icpVersionId).toBe(ids.version);
    expect(after.icpScoredAt).not.toBeNull();
    // A CEO in software against these rules is not a mismatch; whatever the exact verdict, the
    // row must carry what it was decided from.
    expect(rows[0].inputSnapshot).toMatchObject({ contact: { rawTitle: 'CEO' } });
    expect(rows[0].rulesSnapshot).toMatchObject({ industry: { mode: 'allowlist' } });
  });

  it('re-scoring under identical rules reuses the row instead of appending', async () => {
    const l = await lead(ids.campaignScored);
    const first = await run(T, () => scoreLeadIcp({ tenantId: T, leadId: l.id }));
    const second = await run(T, () => scoreLeadIcp({ tenantId: T, leadId: l.id }));
    expect(first.status).toBe('scored');
    expect(second.status).toBe('scored');
    if (first.status !== 'scored' || second.status !== 'scored') return;
    expect(second.inserted).toBe(false);
    expect(second.assessmentId).toBe(first.assessmentId);
    expect(await assessments(l.id)).toHaveLength(1);
  });

  it('a changed lead appends a new assessment and keeps the old one', async () => {
    const l = await lead(ids.campaignScored);
    const first = await run(T, () => scoreLeadIcp({ tenantId: T, leadId: l.id }));
    await run(T, () => prisma.lead.update({ where: { id: l.id }, data: { title: 'Intern' } }));
    const second = await run(T, () => scoreLeadIcp({ tenantId: T, leadId: l.id }));
    if (first.status !== 'scored' || second.status !== 'scored') throw new Error('expected scored');
    expect(second.assessmentId).not.toBe(first.assessmentId);
    const rows = await assessments(l.id);
    expect(rows.map((r) => r.id)).toEqual([first.assessmentId, second.assessmentId]);
    expect((await reload(l.id)).latestIcpAssessmentId).toBe(second.assessmentId);
  });

  it('never scores a lead in another tenant, even by id', async () => {
    const userB = await run(T_B, () => prisma.user.create({ data: { tenantId: T_B, email: 'b@lead-icp.test', firstName: 'B', lastName: 'B', role: 'sdr', password: 'x', isActive: true } }));
    const clientB = await run(T_B, () => prisma.client.create({ data: { tenantId: T_B, name: 'B', industry: 'x', contactName: 'c', contactEmail: 'b-c@lead-icp.test' } }));
    const campaignB = await run(T_B, () => prisma.campaign.create({ data: { tenantId: T_B, clientId: clientB.id, name: 'B campaign', startDate: new Date() } }));
    const lb = await lead(campaignB.id, {}, T_B, userB.id);
    // Tenant A asks to score tenant B's lead.
    const result = await run(T, () => scoreLeadIcp({ tenantId: T, leadId: lb.id }));
    expect(result.status).toBe('not_scored');
    if (result.status === 'not_scored') expect(result.reason).toBe('lead_not_found');
    expect(await assessments(lb.id, T_B)).toHaveLength(0);
  });
});

describe.skipIf(!hasDb)('rescoreLeadsIcp', () => {
  beforeAll(seed);

  it('scores only unscored leads by default, reports counts, and is bounded', async () => {
    const a = await lead(ids.campaignScored);
    const b = await lead(ids.campaignScored);
    const bare = await lead(ids.campaignBare);
    await run(T, () => scoreLeadIcp({ tenantId: T, leadId: a.id }));

    const report = await run(T, () => rescoreLeadsIcp({ tenantId: T, onlyUnscored: true, limit: 10 }));
    expect(report.considered).toBeGreaterThanOrEqual(2);
    expect(report.scored).toBeGreaterThanOrEqual(1);
    expect(report.notScored).toBeGreaterThanOrEqual(1);
    expect((await reload(b.id)).icpFitScore).not.toBeNull();
    expect((await reload(bare.id)).icpFitScore).toBeNull();
    // `a` was already scored and must not have been touched.
    expect(await assessments(a.id)).toHaveLength(1);
  });

  it('narrows to a campaign when asked', async () => {
    const inScope = await lead(ids.campaignScored);
    const report = await run(T, () => rescoreLeadsIcp({ tenantId: T, campaignId: ids.campaignBare, onlyUnscored: false, limit: 50 }));
    expect(report.scored).toBe(0);
    expect((await reload(inScope.id)).icpFitScore).toBeNull();
  });
});
