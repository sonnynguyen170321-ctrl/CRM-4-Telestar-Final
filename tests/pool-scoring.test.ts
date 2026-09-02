import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { assessmentFingerprint, buildScoringEvidence, scorePoolItem } from '@/lib/leadgen/scorePoolItem';

// Scoring at import is the gate the CRM did not have. These run against the real database because
// what matters here is what is PERSISTED — that a rerun appends nothing, that the mirror agrees with
// the assessment, and that a reviewer's own verdict survives a re-score.

const TENANT = 'default-tenant';

// Built from the canonical empty rule set rather than hand-written: the engine reads geography,
// size, weights and thresholds too, and a partial literal fails inside a gate rather than at the
// call, which says nothing useful about what is missing.
const RULES = (() => {
  const rules = emptyIcpRulesV2('test-rules', 'Test ICP');
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

async function seedIcpVersion(): Promise<string> {
  const profile = await prisma.icpProfile.create({
    data: { name: `scoring-test-${randomUUID()}`, tenantId: TENANT, isDefault: false },
    select: { id: true },
  });
  const version = await prisma.icpVersion.create({
    data: {
      icpProfileId: profile.id,
      versionNumber: 1,
      status: 'published',
      rulesJson: RULES as never,
      tenantId: TENANT,
    },
    select: { id: true },
  });
  return version.id;
}

async function seedPoolItem(overrides: Record<string, unknown> = {}) {
  return prisma.leadPoolItem.create({
    data: {
      company: `Acme ${randomUUID().slice(0, 8)}`,
      firstName: 'Jane',
      lastName: 'Doe',
      email: `jane-${randomUUID().slice(0, 8)}@acme.com`,
      title: 'CEO',
      industry: 'Software',
      country: 'Vietnam',
      website: 'https://acme.com',
      sourceType: 'csv_import',
      status: 'imported',
      qualification: 'unreviewed',
      tenantId: TENANT,
      ...overrides,
    },
    select: {
      id: true, company: true, title: true, email: true, country: true,
      industry: true, website: true, accountId: true, qualification: true,
    },
  });
}

describe('scorePoolItem', () => {
  let icpVersionId: string;

  beforeAll(async () => {
    icpVersionId = await seedIcpVersion();
  });

  it('writes an assessment and mirrors it onto the pool record', async () => {
    const item = await seedPoolItem();

    const result = await scorePoolItem({ tenantId: TENANT, item, icpVersionId, rules: RULES });

    expect(result.inserted).toBe(true);

    const stored = await prisma.leadPoolItem.findFirstOrThrow({
      where: { id: item.id },
      select: { latestAssessmentId: true, icpFitScore: true, icpQualification: true, dataQualityScore: true },
    });
    expect(stored.latestAssessmentId).toBe(result.assessmentId);
    expect(stored.icpFitScore).toBe(result.fitScore);
    expect(stored.icpQualification).toBe(result.qualification);
    expect(stored.dataQualityScore).not.toBeNull();
  });

  it('re-scoring the same record under the same rules appends nothing', async () => {
    const item = await seedPoolItem();

    const first = await scorePoolItem({ tenantId: TENANT, item, icpVersionId, rules: RULES });
    const second = await scorePoolItem({ tenantId: TENANT, item, icpVersionId, rules: RULES });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.assessmentId).toBe(first.assessmentId);

    const count = await prisma.leadPoolAssessment.count({ where: { tenantId: TENANT, poolItemId: item.id } });
    expect(count).toBe(1);
  });

  it('keeps the old assessment when the rules change, rather than overwriting it', async () => {
    const item = await seedPoolItem();
    await scorePoolItem({ tenantId: TENANT, item, icpVersionId, rules: RULES });

    // Same record, different rules: a second verdict, and the first one still readable.
    const tightened = { ...RULES, industry: { ...RULES.industry, targetIndustries: ['mining'] } };
    const second = await scorePoolItem({ tenantId: TENANT, item, icpVersionId, rules: tightened });

    expect(second.inserted).toBe(true);

    const assessments = await prisma.leadPoolAssessment.findMany({
      where: { tenantId: TENANT, poolItemId: item.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, rulesSnapshot: true },
    });
    expect(assessments).toHaveLength(2);
    // The rules that produced each verdict travel with it — that is what makes an old score
    // explainable after the ICP has moved on.
    expect((assessments[0].rulesSnapshot as any).industry.targetIndustries).toEqual(['software']);
    expect((assessments[1].rulesSnapshot as any).industry.targetIndustries).toEqual(['mining']);

    const stored = await prisma.leadPoolItem.findFirstOrThrow({
      where: { id: item.id },
      select: { latestAssessmentId: true },
    });
    expect(stored.latestAssessmentId).toBe(second.assessmentId);
  });

  it('never overwrites the reviewer verdict on the pool record', async () => {
    const item = await seedPoolItem();
    await prisma.leadPoolItem.update({ where: { id: item.id }, data: { qualification: 'qualified' } });

    await scorePoolItem({ tenantId: TENANT, item, icpVersionId, rules: RULES });

    const stored = await prisma.leadPoolItem.findFirstOrThrow({
      where: { id: item.id },
      select: { qualification: true, icpQualification: true },
    });
    // `qualification` is the human's; `icpQualification` is the engine's. A re-score moves the
    // second and must never touch the first.
    expect(stored.qualification).toBe('qualified');
    expect(stored.icpQualification).not.toBeNull();
  });

  it('changes the fingerprint when either the record or the rules change', () => {
    const item = { id: 'x', company: 'Acme', title: 'CEO', email: 'a@acme.com', country: 'VN', industry: 'Software', website: null, accountId: null };
    const base = assessmentFingerprint(buildScoringEvidence(item), RULES);

    const otherRecord = assessmentFingerprint(buildScoringEvidence({ ...item, title: 'Intern' }), RULES);
    const otherRules = assessmentFingerprint(
      buildScoringEvidence(item),
      { ...RULES, industry: { ...RULES.industry, targetIndustries: ['mining'] } }
    );

    expect(otherRecord).not.toBe(base);
    expect(otherRules).not.toBe(base);
  });
});
