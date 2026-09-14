import type { IcpQualification } from "@prisma/client";
import { assessIcpRulesV2 } from "@telestar/core-scoring/rules/deriveQualification";
import type { RawScoringEvidence } from "@telestar/core-scoring/rules/evidence";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import { deriveSimpleIcpQualification } from "@/lib/leadgen/scorePoolItem";

/**
 * Read-only audit of how much industry evidence is deciding ICP verdicts.
 *
 * Every assessment persists its full input and rules snapshots, so the verdict can be recomputed
 * here with the same pure engine that produced it — no database, no crawler, no AI. The question
 * it answers is the one that decides whether wiring a company classifier is worth it: how many
 * records are parked in Review *only* because the industry is unknown, and how many are rejected
 * on nothing stronger than the label someone typed into the upload.
 */

export type IcpIndustryEvidenceBucket =
  | "not_allowlist"
  | "allowlist_industry_unknown"
  | "allowlist_match"
  | "allowlist_miss";

export const ICP_INDUSTRY_EVIDENCE_BUCKETS: readonly IcpIndustryEvidenceBucket[] = [
  "not_allowlist",
  "allowlist_industry_unknown",
  "allowlist_match",
  "allowlist_miss",
];

export type AuditableAssessment = {
  assessmentId: string;
  poolItemId: string;
  icpVersionId: string;
  persistedQualification: IcpQualification;
  inputSnapshot: RawScoringEvidence;
  rulesSnapshot: IcpVersionRulesV2;
};

export type IcpIndustryEvidenceFinding = {
  assessmentId: string;
  poolItemId: string;
  icpVersionId: string;
  bucket: IcpIndustryEvidenceBucket;
  persistedQualification: IcpQualification;
  recomputedQualification: IcpQualification;
  /** The engine no longer agrees with the stored verdict — rules or engine changed since. */
  drifted: boolean;
  /** Review is caused by the unknown industry alone: a matching industry would qualify. */
  industrySoleBlocker: boolean;
  /** An allowlist rejection with no evidence beyond the uploaded `industry` string. */
  uploadedLabelOnly: boolean;
};

const recompute = (evidence: RawScoringEvidence, rules: IcpVersionRulesV2) =>
  deriveSimpleIcpQualification(assessIcpRulesV2(evidence, rules), rules, evidence);

const classifyBucket = (
  evidence: RawScoringEvidence,
  rules: IcpVersionRulesV2,
): IcpIndustryEvidenceBucket => {
  if (rules.industry.mode !== "allowlist") return "not_allowlist";
  const industry = assessIcpRulesV2(evidence, rules).dimensionResults.industry;
  if (industry.missingEvidence.includes("industry_unknown")) return "allowlist_industry_unknown";
  if (industry.hits.some((hit) => hit.id === "industry_allowlist_match")) return "allowlist_match";
  return "allowlist_miss";
};

/**
 * Counterfactual, not inference: score the same record once more with the ICP's first target
 * industry filled in. If that alone turns Review into Qualified, industry was the only thing missing.
 */
const wouldQualifyWithMatchingIndustry = (
  evidence: RawScoringEvidence,
  rules: IcpVersionRulesV2,
): boolean => {
  const target = rules.industry.targetIndustries[0] ?? rules.industry.subIndustries[0];
  if (!target) return false;
  const counterfactual: RawScoringEvidence = {
    ...evidence,
    company: { ...evidence.company, industry: target },
  };
  return recompute(counterfactual, rules) === "qualified";
};

const restsOnUploadedLabelOnly = (evidence: RawScoringEvidence): boolean =>
  Boolean(evidence.company.industry) &&
  !evidence.company.industryCategory &&
  (evidence.company.industryTags ?? []).length === 0;

export const auditIndustryEvidence = (row: AuditableAssessment): IcpIndustryEvidenceFinding => {
  const { inputSnapshot: evidence, rulesSnapshot: rules } = row;
  const bucket = classifyBucket(evidence, rules);
  const recomputedQualification = recompute(evidence, rules);

  return {
    assessmentId: row.assessmentId,
    poolItemId: row.poolItemId,
    icpVersionId: row.icpVersionId,
    bucket,
    persistedQualification: row.persistedQualification,
    recomputedQualification,
    drifted: recomputedQualification !== row.persistedQualification,
    industrySoleBlocker:
      bucket === "allowlist_industry_unknown" &&
      recomputedQualification === "needs_review" &&
      wouldQualifyWithMatchingIndustry(evidence, rules),
    uploadedLabelOnly: bucket === "allowlist_miss" && restsOnUploadedLabelOnly(evidence),
  };
};

type BucketCounts = Record<IcpIndustryEvidenceBucket, number>;

type IcpVersionBreakdown = {
  total: number;
  byBucket: BucketCounts;
  industrySoleBlocker: number;
  allowlistMissUploadedLabelOnly: number;
};

export type IcpIndustryEvidenceSummary = {
  total: number;
  byQualification: Record<IcpQualification, number>;
  byBucket: BucketCounts;
  industrySoleBlocker: number;
  allowlistMissUploadedLabelOnly: number;
  drifted: number;
  byIcpVersion: Record<string, IcpVersionBreakdown>;
  /** Pool item ids per bucket, capped, for a human spot-check before trusting the counts. */
  samples: Record<IcpIndustryEvidenceBucket, string[]>;
};

const emptyBucketCounts = (): BucketCounts =>
  Object.fromEntries(ICP_INDUSTRY_EVIDENCE_BUCKETS.map((bucket) => [bucket, 0])) as BucketCounts;

const emptyVersionBreakdown = (): IcpVersionBreakdown => ({
  total: 0,
  byBucket: emptyBucketCounts(),
  industrySoleBlocker: 0,
  allowlistMissUploadedLabelOnly: 0,
});

const DEFAULT_SAMPLE_SIZE = 10;

export const summarizeIcpIndustryEvidence = (
  rows: readonly AuditableAssessment[],
  options: { sampleSize?: number } = {},
): IcpIndustryEvidenceSummary => {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const findings = rows.map(auditIndustryEvidence);

  const byIcpVersion: Record<string, IcpVersionBreakdown> = {};
  const samples = Object.fromEntries(
    ICP_INDUSTRY_EVIDENCE_BUCKETS.map((bucket) => [bucket, [] as string[]]),
  ) as Record<IcpIndustryEvidenceBucket, string[]>;

  for (const finding of findings) {
    const version = (byIcpVersion[finding.icpVersionId] ??= emptyVersionBreakdown());
    version.total += 1;
    version.byBucket[finding.bucket] += 1;
    if (finding.industrySoleBlocker) version.industrySoleBlocker += 1;
    if (finding.uploadedLabelOnly) version.allowlistMissUploadedLabelOnly += 1;
    if (samples[finding.bucket].length < sampleSize) samples[finding.bucket].push(finding.poolItemId);
  }

  const count = (predicate: (finding: IcpIndustryEvidenceFinding) => boolean) =>
    findings.filter(predicate).length;

  return {
    total: findings.length,
    byQualification: {
      qualified: count((f) => f.persistedQualification === "qualified"),
      needs_review: count((f) => f.persistedQualification === "needs_review"),
      unqualified: count((f) => f.persistedQualification === "unqualified"),
    },
    byBucket: Object.fromEntries(
      ICP_INDUSTRY_EVIDENCE_BUCKETS.map((bucket) => [bucket, count((f) => f.bucket === bucket)]),
    ) as BucketCounts,
    industrySoleBlocker: count((f) => f.industrySoleBlocker),
    allowlistMissUploadedLabelOnly: count((f) => f.uploadedLabelOnly),
    drifted: count((f) => f.drifted),
    byIcpVersion,
    samples,
  };
};
