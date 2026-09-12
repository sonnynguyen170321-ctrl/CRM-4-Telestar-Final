import { PrismaClient } from "@prisma/client";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rescorePool } from "@/lib/leadgen/rescorePool";

const hasDb = Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();

const tenantId = "campaign-scoring-tenant";
const clientId = "campaign-scoring-client";
const profileId = "campaign-scoring-profile";
const versionA = "campaign-scoring-v-a";
const versionB = "campaign-scoring-v-b";
const campaignA = "campaign-scoring-a";
const campaignB = "campaign-scoring-b";
const poolItemId = "campaign-scoring-pool";

const rules = (() => {
  const value = emptyIcpRulesV2("campaign-scoring", "Campaign scoring");
  value.industry = {
    ...value.industry,
    mode: "allowlist",
    targetIndustries: ["software"],
  };
  return value;
})();

async function cleanup() {
  await prisma.campaignProspect.deleteMany({ where: { tenantId } });
  await prisma.leadPoolAssessment.deleteMany({ where: { tenantId } });
  await prisma.leadPoolItem.deleteMany({ where: { tenantId } });
  await prisma.campaign.deleteMany({ where: { tenantId } });
  await prisma.icpVersion.deleteMany({ where: { tenantId } });
  await prisma.icpProfile.deleteMany({ where: { tenantId } });
  await prisma.client.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

describe.skipIf(!hasDb)("campaign-scoped ICP scoring", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.tenant.create({
      data: { id: tenantId, name: "Campaign scoring test" },
    });
    await prisma.client.create({
      data: {
        id: clientId,
        tenantId,
        name: "Scoring client",
        industry: "Software",
        contactName: "Owner",
        contactEmail: "owner@scoring.test",
      },
    });
    await prisma.icpProfile.create({
      data: { id: profileId, tenantId, name: "Scoring ICP" },
    });
    await prisma.icpVersion.createMany({
      data: [
        {
          id: versionA,
          tenantId,
          icpProfileId: profileId,
          versionNumber: 1,
          status: "published",
          rulesJson: rules as never,
        },
        {
          id: versionB,
          tenantId,
          icpProfileId: profileId,
          versionNumber: 2,
          status: "published",
          rulesJson: rules as never,
        },
      ],
    });
    await prisma.campaign.createMany({
      data: [
        {
          id: campaignA,
          tenantId,
          clientId,
          name: "Campaign A",
          startDate: new Date("2026-09-01"),
          icpVersionId: versionA,
        },
        {
          id: campaignB,
          tenantId,
          clientId,
          name: "Campaign B",
          startDate: new Date("2026-09-01"),
          icpVersionId: versionB,
        },
      ],
    });
    await prisma.leadPoolItem.create({
      data: {
        id: poolItemId,
        tenantId,
        company: "Reusable Software Co",
        title: "CEO",
        email: "ceo@reusable.test",
        industry: "Software",
        tags: [],
      },
    });
    await prisma.campaignProspect.createMany({
      data: [
        { tenantId, campaignId: campaignA, poolItemId },
        { tenantId, campaignId: campaignB, poolItemId },
      ],
    });
  });

  afterAll(async () => {
    if (hasDb) await cleanup();
    await prisma.$disconnect();
  });

  it("stores independent assessment pointers for identical rules in two campaigns", async () => {
    expect(
      await rescorePool({
        tenantId,
        selection: { kind: "campaign", campaignId: campaignA },
      }),
    ).toMatchObject({
      considered: 1,
      scored: 1,
      failed: [],
    });

    let rows = await prisma.campaignProspect.findMany({
      where: { tenantId, poolItemId },
      orderBy: { campaignId: "asc" },
    });
    expect(rows[0].assessedIcpVersionId).toBe(versionA);
    expect(rows[0].latestAssessmentId).not.toBeNull();
    expect(rows[1].latestAssessmentId).toBeNull();

    expect(
      await rescorePool({
        tenantId,
        selection: { kind: "campaign", campaignId: campaignB },
      }),
    ).toMatchObject({
      considered: 1,
      scored: 1,
      failed: [],
    });
    rows = await prisma.campaignProspect.findMany({
      where: { tenantId, poolItemId },
      orderBy: { campaignId: "asc" },
    });
    expect(rows[1].assessedIcpVersionId).toBe(versionB);
    expect(rows[1].latestAssessmentId).not.toBeNull();
    expect(rows[1].latestAssessmentId).not.toBe(rows[0].latestAssessmentId);

    const globalMirror = await prisma.leadPoolItem.findUniqueOrThrow({
      where: { id: poolItemId },
      select: { latestAssessmentId: true, icpQualification: true },
    });
    expect(globalMirror).toEqual({
      latestAssessmentId: null,
      icpQualification: null,
    });
  });

  it("converges independently per campaign", async () => {
    const secondA = await rescorePool({
      tenantId,
      selection: { kind: "campaign", campaignId: campaignA },
    });
    const secondB = await rescorePool({
      tenantId,
      selection: { kind: "campaign", campaignId: campaignB },
    });
    expect(secondA).toMatchObject({ scored: 0, unchanged: 1, failed: [] });
    expect(secondB).toMatchObject({ scored: 0, unchanged: 1, failed: [] });
    expect(
      await prisma.leadPoolAssessment.count({
        where: { tenantId, poolItemId },
      }),
    ).toBe(2);
  });

  it("converges when two campaign rescores race", async () => {
    const racingPoolItemId = "campaign-scoring-race-pool";
    await prisma.leadPoolItem.create({
      data: {
        id: racingPoolItemId,
        tenantId,
        company: "Racing Software Co",
        title: "Founder",
        email: "founder@racing.test",
        industry: "Software",
        tags: [],
      },
    });
    await prisma.campaignProspect.create({
      data: { tenantId, campaignId: campaignA, poolItemId: racingPoolItemId },
    });

    const results = await Promise.all([
      rescorePool({
        tenantId,
        selection: { kind: "campaign", campaignId: campaignA },
      }),
      rescorePool({
        tenantId,
        selection: { kind: "campaign", campaignId: campaignA },
      }),
    ]);
    expect(results.flatMap((result) => result.failed)).toEqual([]);
    expect(
      await prisma.leadPoolAssessment.count({
        where: {
          tenantId,
          poolItemId: racingPoolItemId,
          icpVersionId: versionA,
        },
      }),
    ).toBe(1);
  });
});
