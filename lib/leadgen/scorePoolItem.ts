import { createHash } from "node:crypto";

import type { IcpQualification, Prisma } from "@prisma/client";
import {
  assessIcpRulesV2,
  type IcpRulesV2Assessment,
} from "@telestar/core-scoring/rules/deriveQualification";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import type { RawScoringEvidence } from "@telestar/core-scoring/rules/evidence";
import { normalizeEvidence } from "@telestar/core-scoring/rules/normalize/index";
import type { IntelligenceCompanyEvidence } from "@telestar/core-intel/mapIntelligenceToCompanyEvidence";

import { accountIdentityOf } from "@/lib/identity/resolveAccount";
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
};

const MISMATCH_REASON_CODES = new Set([
  "target_geo_mismatch_explicit",
  "target_industry_mismatch",
  "target_company_type_mismatch",
  "target_size_too_small",
  "target_size_too_large",
  "target_size_mismatch",
  "persona_title_denylisted",
  "persona_seniority_excluded",
  "persona_title_off_target",
  "persona_below_seniority_floor",
  "persona_department_off_target",
]);

/**
 * Three-state must-have decision. Weighted scores remain evidence for explanation/sorting only.
 *
 * A known contradiction wins over missing evidence; otherwise incomplete required/configured
 * evidence goes to human Review. With no contradiction or missing must-have, the prospect Fits.
 */
export function deriveSimpleIcpQualification(
  assessed: IcpRulesV2Assessment,
  rules: IcpVersionRulesV2,
  rawEvidence: RawScoringEvidence,
): IcpQualification {
  if (assessed.gates.disqualified) return "unqualified";

  const evidence = normalizeEvidence(rawEvidence);
  const dimensionResults = Object.values(assessed.dimensionResults);
  const hasKnownMismatch = dimensionResults.some((result) =>
    result.hits.some((hit) => {
      // An unrecognized title is missing evidence, not proof that the contact is
      // below the configured seniority floor.
      if (
        hit.reasonCode === "persona_below_seniority_floor" &&
        evidence.contact?.seniorityTier === "UNKNOWN"
      ) {
        return false;
      }
      return MISMATCH_REASON_CODES.has(hit.reasonCode);
    }),
  );
  const industryAllowlistMiss =
    rules.industry.mode === "allowlist" &&
    assessed.dimensionResults.industry.missingEvidence.length === 0 &&
    !assessed.dimensionResults.industry.hits.some(
      (hit) => hit.id === "industry_allowlist_match",
    );

  if (hasKnownMismatch || industryAllowlistMiss) return "unqualified";

  const personaNeedsTitle =
    rules.persona.requirePersonaForFinalQualification ||
    rules.persona.titleAllowlist.length > 0 ||
    rules.persona.titleDenylist.length > 0 ||
    rules.persona.titleTiers.length > 0 ||
    rules.persona.titleKeywords.length > 0 ||
    rules.persona.seniorityFloor !== undefined ||
    rules.persona.seniorityExclusions.length > 0 ||
    rules.persona.departmentAllowlist.length > 0;
  const personaEvidenceMissing =
    (personaNeedsTitle && !evidence.contact?.titlePresent) ||
    (rules.persona.seniorityFloor !== undefined &&
      evidence.contact?.seniorityTier === "UNKNOWN") ||
    (rules.persona.departmentAllowlist.length > 0 &&
      evidence.contact?.department === "UNKNOWN");
  const geoEvidenceMissing =
    (rules.geography.targetCountries.length > 0 ||
      rules.geography.targetRegions.length > 0 ||
      rules.geography.excludedCountries.length > 0) &&
    !evidence.company.countryKnown;
  const industryEvidenceMissing =
    (rules.industry.mode === "allowlist" ||
      rules.industry.mode === "denylist" ||
      rules.industry.excludedIndustries.length > 0) &&
    !evidence.company.industryCanonical &&
    !evidence.company.industryRaw &&
    evidence.company.industryTags.length === 0;

  const missingConfiguredEvidence = dimensionResults
    .filter((result) => result.dimension !== "signals")
    .some((result) => result.missingEvidence.length > 0);
  if (
    assessed.requiredEvidenceMissing.length > 0 ||
    missingConfiguredEvidence ||
    personaEvidenceMissing ||
    geoEvidenceMissing ||
    industryEvidenceMissing
  ) {
    return "needs_review";
  }

  return "qualified";
}

function simpleQualificationReason(qualification: IcpQualification): string {
  if (qualification === "unqualified") return "simple_known_mismatch";
  if (qualification === "needs_review") return "simple_missing_evidence";
  return "simple_all_must_haves_pass";
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

/**
 * The intelligence fields the V2 engine actually reads. `IntelligenceCompanyEvidence` is a pick of
 * the V1 `CompanyEvidence`, which also carries `pricingSignals`, `platformSignals`, `notes` and
 * `pipelineInferredCountry`; a spread would let those into `inputSnapshot` and the fingerprint,
 * so a classifier rerun that changed nothing scoring reads would still mint a new assessment.
 * Copying by name keeps the fingerprint sensitive to evidence only.
 */
const SCORING_INTELLIGENCE_FIELDS = [
  "description",
  "industryTags",
  "industryCategory",
  "productSignals",
  "serviceSignals",
  "employeeCount",
  "employeeRange",
  "revenueUsd",
  "officeCountries",
  "locationCount",
  "evidenceText",
] as const satisfies ReadonlyArray<keyof IntelligenceCompanyEvidence & keyof RawScoringEvidence["company"]>;

type ScoringIntelligenceEvidence = Pick<
  RawScoringEvidence["company"],
  (typeof SCORING_INTELLIGENCE_FIELDS)[number]
>;

const scoringEvidenceFromIntelligence = (
  intelligence: IntelligenceCompanyEvidence,
): ScoringIntelligenceEvidence =>
  Object.fromEntries(
    SCORING_INTELLIGENCE_FIELDS.filter((field) => intelligence[field] !== undefined).map(
      (field) => [field, intelligence[field]],
    ),
  ) as ScoringIntelligenceEvidence;

/**
 * Company intelligence enters scoring only as `IntelligenceCompanyEvidence` — the controlled-token
 * mapping in `@telestar/core-intel`, never the free-text company summary. A summary is written by
 * the classifier; feeding it back as `description` would let one run's verdict become the next
 * run's evidence. The record's own fields win where the two overlap.
 *
 * Key order is part of the assessment fingerprint: the record fields keep their historical order so
 * an unchanged record without intelligence still hashes to its existing assessment.
 */
export function buildScoringEvidence(
  item: ScorablePoolItem,
  intelligence?: IntelligenceCompanyEvidence | null,
): RawScoringEvidence {
  return {
    company: {
      ...(intelligence ? scoringEvidenceFromIntelligence(intelligence) : {}),
      companyName: item.company,
      industry: item.industry ?? undefined,
      country: item.country ?? undefined,
      domain:
        accountIdentityOf({ name: item.company, website: item.website })
          .canonicalDomain ?? undefined,
      websiteStatus:
        intelligence?.websiteStatus ?? (item.website ? "reachable" : "missing"),
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
  return createHash("sha256")
    .update(JSON.stringify({ evidence, rules, icpVersionId }))
    .digest("hex");
}

export async function scorePoolItem(params: {
  tenantId: string;
  item: ScorablePoolItem;
  icpVersionId: string;
  /** Set for campaign-scoped scoring; absent only for the tenant default/unassigned pool. */
  campaignId?: string | null;
  rules: IcpVersionRulesV2;
  intelligence?: IntelligenceCompanyEvidence | null;
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
  const qualification = deriveSimpleIcpQualification(assessed, rules, evidence);
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
          fitScore: assessed.fitScore,
          confidenceScore: assessed.confidenceScore,
          dataQualityScore,
          qualification,
          evidenceJson: {
            subScores: assessed.subScores,
            gates: assessed.gates,
            missingEvidence: assessed.missingEvidence,
            requiredEvidenceMissing: assessed.requiredEvidenceMissing,
            reasonCodes: [simpleQualificationReason(qualification)],
            weightedDiagnostics: {
              qualification: assessed.qualification,
              reasonCodes: assessed.reasonCodes,
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
        fitScore: assessed.fitScore,
        dataQualityScore,
        qualification,
      });

      return row;
    });

    return {
      assessmentId: created.id,
      inserted: true,
      fitScore: assessed.fitScore,
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
