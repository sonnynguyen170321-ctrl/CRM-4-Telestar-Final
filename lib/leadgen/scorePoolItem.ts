import { createHash } from "node:crypto";

import type { IcpQualification, Prisma } from "@prisma/client";
import { assessIcpRulesV2 } from "@telestar/core-scoring/rules/deriveQualification";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import type { RawScoringEvidence } from "@telestar/core-scoring/rules/evidence";

import { accountIdentityOf } from "@/lib/identity/resolveAccount";
import {
  deriveIcpVerdict,
  verdictVersionFor,
  type IcpVerdict,
} from "@/lib/leadgen/pointsQualification";
import { prisma } from "@/lib/prisma";

type ScorablePoolItem = {
  id: string;
  company: string;
  title: string | null;
  email: string | null;
  country: string | null;
  industry: string | null;
  website: string | null;
  accountId: string | null;
  /** Headcount from the account (import staff size), when known. */
  employeeCount?: number | null;
};

/**
 * The stored verdict comes from `deriveIcpVerdict`: per-value points when the ICP turns them on
 * (`lib/leadgen/pointsQualification.ts`), otherwise weighted dimensions
 * (`lib/leadgen/weightedQualification.ts`). Only disqualifiers and explicit exclusions are fatal under
 * either. Both replaced a must-have rule under which any single mismatch was `unqualified`.
 */
export { deriveIcpVerdict };

/** What `evidenceJson` records about the verdict, for the explanation drawers. */
export function verdictEvidence(verdict: IcpVerdict, rules: IcpVersionRulesV2) {
  return {
    reasonCodes: [verdict.reason],
    verdict: {
      version: verdictVersionFor(rules),
      ...(verdict.points ? { points: verdict.points } : {}),
      reason: verdict.reason,
      fitScore: verdict.fitScore,
      scoredDimensions: verdict.scoredDimensions,
      missingCoreEvidence: verdict.missingCoreEvidence,
    },
  };
}

export type ScorePoolItemResult = {
  assessmentId: string;
  inserted: boolean;
  fitScore: number;
  qualification: IcpQualification;
};

export async function resolveIcpVersionId(
  tenantId: string,
  campaignId: string | null,
): Promise<string | null> {
  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { icpVersionId: true },
    });
    if (campaign?.icpVersionId) return campaign.icpVersionId;
  }

  const fallback = await prisma.icpVersion.findFirst({
    where: { tenantId, status: "published", icpProfile: { isDefault: true } },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

export function buildScoringEvidence(
  item: ScorablePoolItem,
  intelligence?: {
    industryCategory: string | null;
    facts: string[];
    summary: string | null;
  } | null,
): RawScoringEvidence {
  return {
    company: {
      companyName: item.company,
      industry: item.industry ?? undefined,
      industryCategory: intelligence?.industryCategory ?? undefined,
      country: item.country ?? undefined,
      domain:
        accountIdentityOf({ name: item.company, website: item.website })
          .canonicalDomain ?? undefined,
      employeeCount:
        item.employeeCount != null && item.employeeCount > 0
          ? item.employeeCount
          : undefined,
      websiteStatus: item.website ? "reachable" : "missing",
      description: intelligence?.summary ?? undefined,
      industryTags: intelligence?.facts ?? undefined,
    },
    contact: {
      rawTitle: item.title ?? undefined,
      email: item.email ?? undefined,
      contactCountry: item.country ?? undefined,
    },
  };
}

/**
 * Hash the evidence, rules and immutable ICP version identity.
 *
 * Version identity matters even when two versions currently contain identical JSON: campaign A's
 * assessment cannot satisfy campaign B's composite foreign key or explain which manager contract
 * produced the verdict.
 */
export function assessmentFingerprint(
  evidence: RawScoringEvidence,
  rules: IcpVersionRulesV2,
  icpVersionId: string,
): string {
  // The verdict rule's version is hashed in: assessments are reused by fingerprint, so without it a
  // rescore under a new rule would find the old row and return the old verdict.
  return createHash("sha256")
    .update(JSON.stringify({ evidence, rules, icpVersionId, verdict: verdictVersionFor(rules) }))
    .digest("hex");
}

export async function scorePoolItem(params: {
  tenantId: string;
  item: ScorablePoolItem;
  icpVersionId: string;
  /** Set for campaign-scoped scoring; absent only for the tenant default/unassigned pool. */
  campaignId?: string | null;
  rules: IcpVersionRulesV2;
  intelligence?: {
    industryCategory: string | null;
    facts: string[];
    summary: string | null;
  } | null;
}): Promise<ScorePoolItemResult> {
  const { tenantId, item, icpVersionId, campaignId = null, rules } = params;

  const evidence = buildScoringEvidence(item, params.intelligence);
  const fingerprint = assessmentFingerprint(evidence, rules, icpVersionId);

  const existing = await prisma.leadPoolAssessment.findFirst({
    where: { tenantId, poolItemId: item.id, icpVersionId, fingerprint },
    select: { id: true, fitScore: true, qualification: true },
  });
  if (existing) {
    await pointAtAssessment(prisma, {
      tenantId,
      campaignId,
      poolItemId: item.id,
      icpVersionId,
      assessmentId: existing.id,
      fitScore: existing.fitScore,
      dataQualityScore: null,
      qualification: existing.qualification,
    });
    return {
      assessmentId: existing.id,
      inserted: false,
      fitScore: existing.fitScore,
      qualification: existing.qualification,
    };
  }

  const assessed = assessIcpRulesV2(evidence, rules);
  const verdict = deriveIcpVerdict(assessed, rules, evidence);
  const { qualification, fitScore } = verdict;
  const dataQualityScore = Math.max(
    0,
    100 - assessed.missingEvidence.length * 10,
  );

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.leadPoolAssessment.create({
        data: {
          tenantId,
          poolItemId: item.id,
          icpVersionId,
          fitScore,
          confidenceScore: assessed.confidenceScore,
          dataQualityScore,
          qualification,
          evidenceJson: {
            subScores: assessed.subScores,
            gates: assessed.gates,
            missingEvidence: assessed.missingEvidence,
            requiredEvidenceMissing: assessed.requiredEvidenceMissing,
            ...verdictEvidence(verdict, rules),
            weightedDiagnostics: {
              qualification: assessed.qualification,
              reasonCodes: assessed.reasonCodes,
              engineFitScore: assessed.fitScore,
            },
            accountPreRank: assessed.accountPreRank,
            confidenceBand: assessed.confidenceBand,
          } as unknown as Prisma.InputJsonValue,
          inputSnapshot: evidence as unknown as Prisma.InputJsonValue,
          rulesSnapshot: rules as unknown as Prisma.InputJsonValue,
          fingerprint,
        },
        select: { id: true },
      });

      await pointAtAssessment(tx, {
        tenantId,
        campaignId,
        poolItemId: item.id,
        icpVersionId,
        assessmentId: row.id,
        fitScore,
        dataQualityScore,
        qualification,
      });

      return row;
    });

    return {
      assessmentId: created.id,
      inserted: true,
      fitScore,
      qualification,
    };
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "P2002") throw error;

    // Two workers may miss the optimistic lookup together. The unique fingerprint chooses one
    // immutable assessment; the loser converges by moving its own campaign pointer to that row.
    const raced = await prisma.leadPoolAssessment.findFirst({
      where: { tenantId, poolItemId: item.id, icpVersionId, fingerprint },
      select: { id: true, fitScore: true, qualification: true },
    });
    if (!raced) throw error;

    await pointAtAssessment(prisma, {
      tenantId,
      campaignId,
      poolItemId: item.id,
      icpVersionId,
      assessmentId: raced.id,
      fitScore: raced.fitScore,
      dataQualityScore: null,
      qualification: raced.qualification,
    });
    return {
      assessmentId: raced.id,
      inserted: false,
      fitScore: raced.fitScore,
      qualification: raced.qualification,
    };
  }
}

type AssessmentPointerInput = {
  tenantId: string;
  campaignId: string | null;
  poolItemId: string;
  icpVersionId: string;
  assessmentId: string;
  fitScore: number;
  dataQualityScore: number | null;
  qualification: IcpQualification;
};

/**
 * Campaign scoring moves only the CampaignProspect pointer. The pool mirrors are retained solely
 * for an unassigned/default-ICP record; writing one campaign's verdict there would overwrite
 * another campaign's truth.
 */
async function pointAtAssessment(
  db: {
    leadPoolItem: { update: (args: any) => Promise<any> };
    campaignProspect: { updateMany: (args: any) => Promise<{ count: number }> };
  },
  input: AssessmentPointerInput,
): Promise<void> {
  if (input.campaignId) {
    const moved = await db.campaignProspect.updateMany({
      where: {
        tenantId: input.tenantId,
        campaignId: input.campaignId,
        poolItemId: input.poolItemId,
        status: { not: "removed" },
      },
      data: {
        assessedIcpVersionId: input.icpVersionId,
        latestAssessmentId: input.assessmentId,
      },
    });
    if (moved.count !== 1) throw new Error("campaign_prospect_not_found");
    return;
  }

  await db.leadPoolItem.update({
    where: { id: input.poolItemId },
    data: {
      latestAssessmentId: input.assessmentId,
      icpFitScore: input.fitScore,
      icpQualification: input.qualification,
      ...(input.dataQualityScore === null
        ? {}
        : { dataQualityScore: input.dataQualityScore }),
    },
  });
}
