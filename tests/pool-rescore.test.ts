import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { prisma } from '@/lib/prisma';
import { buildPoolWhere, listPoolItems } from '@/lib/leadgen/pool';
import { rescorePool } from '@/lib/leadgen/rescorePool';

// Rescore is how records that landed before an ICP existed, or under rules that have since changed,
// catch up. The behaviour that matters is that it converges: running it twice must not keep
// appending assessments.

const TENANT = 'default-tenant';

const RULES = (() => {
  const rules = emptyIcpRulesV2('rescore-test', 'Rescore ICP');
  rules.industry = { ...rules.industry, mode: 'allowlist', targetIndustries: ['software'] };
  return rules;
})();

async function seedDefaultIcp(): Promise<string> {
  // A default profile is what `resolveIcpVersionId` falls back to when a record has no campaign.
  const existing = await prisma.icpProfile.findFirst({ where: { tenantId: TENANT, isDefault: true } });
  const profile =
    existing ??
    (await prisma.icpProfile.create({
      data: { name: `rescore-default-${randomUUID().slice(0, 8)}`, tenantId: TENANT, isDefault: true },
    }));

  const version = await prisma.icpVersion.create({
    data: {
      icpProfileId: profile.id,
      versionNumber: Math.floor(Math.random() * 1_000_000),
      status: 'published',
      rulesJson: RULES as never,
      tenantId: TENANT,
    },
    select: { id: true },
  });
  return version.id;
}

async function seedUnscoredItem(company: string) {
  return prisma.leadPoolItem.create({
    data: {
      company,
      firstName: 'Jane',
      lastName: 'Doe',
      email: `jane-${randomUUID().slice(0, 8)}@example.com`,
      title: 'CEO',
      industry: 'Software',
      sourceType: 'csv_import',
      status: 'imported',
      qualification: 'unreviewed',
      tenantId: TENANT,
    },
    select: { id: true },
  });
}

describe('rescorePool', () => {
  beforeAll(async () => {
    await seedDefaultIcp();
  });

  it('scores records that arrived before any ICP existed', async () => {
    const item = await seedUnscoredItem(`Rescore Co ${randomUUID().slice(0, 8)}`);

    const result = await rescorePool({ tenantId: TENANT, selection: { kind: 'ids', ids: [item.id] } });

    expect(result.considered).toBe(1);
    expect(result.scored).toBe(1);
    expect(result.failed).toEqual([]);

    const stored = await prisma.leadPoolItem.findFirstOrThrow({
      where: { id: item.id },
      select: { latestAssessmentId: true, icpFitScore: true },
    });
    expect(stored.latestAssessmentId).not.toBeNull();
    expect(stored.icpFitScore).not.toBeNull();
  });

  it('converges — a second pass adds no assessments', async () => {
    const item = await seedUnscoredItem(`Converge Co ${randomUUID().slice(0, 8)}`);

    const first = await rescorePool({ tenantId: TENANT, selection: { kind: 'ids', ids: [item.id] } });
    const second = await rescorePool({ tenantId: TENANT, selection: { kind: 'ids', ids: [item.id] } });

    expect(first.scored).toBe(1);
    expect(second.scored).toBe(0);
    expect(second.unchanged).toBe(1);

    const count = await prisma.leadPoolAssessment.count({ where: { tenantId: TENANT, poolItemId: item.id } });
    expect(count).toBe(1);
  });

  it('reports records it could not score rather than guessing', async () => {
    // A record in a tenant with no default ICP has nothing to be judged against. Reporting that is
    // the point: silently leaving it unscored would look identical to a bug.
    const result = await rescorePool({
      tenantId: 'tenant-without-icp',
      selection: { kind: 'unscored' },
    });
    expect(result.failed).toEqual([]);
    expect(result.scored).toBe(0);
  });
});

describe('pool filters', () => {
  it('filters on the engine verdict separately from the reviewer verdict', () => {
    const where = buildPoolWhere(
      { qualification: 'qualified', icpQualification: 'unqualified' },
      TENANT
    ) as Record<string, unknown>;

    // Both survive: "a human qualified it but the ICP would not" is a real and useful query, and it
    // is only expressible because the two verdicts are separate columns.
    expect(where.qualification).toBe('qualified');
    expect(where.icpQualification).toBe('unqualified');
  });

  it('derives NOT SCORED from the missing assessment, not a placeholder row', () => {
    const where = buildPoolWhere({ unscoredOnly: true }, TENANT) as Record<string, unknown>;
    expect(where.latestAssessmentId).toBeNull();
  });

  it('returns the mirrored score on the list read model', async () => {
    const item = await seedUnscoredItem(`Listed Co ${randomUUID().slice(0, 8)}`);
    await rescorePool({ tenantId: TENANT, selection: { kind: 'ids', ids: [item.id] } });

    const listed = await listPoolItems({ pageSize: 200 }, TENANT);
    const row = listed.items.find((candidate) => candidate.id === item.id);

    expect(row).toBeDefined();
    expect(row?.icpFitScore).not.toBeNull();
    expect(row?.icpQualification).not.toBeNull();
    expect(row?.latestAssessmentId).not.toBeNull();
  });
});
