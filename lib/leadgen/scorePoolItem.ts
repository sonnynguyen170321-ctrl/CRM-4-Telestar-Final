import { createHash } from 'node:crypto';

import type { IcpQualification, Prisma } from '@prisma/client';
import { assessIcpRulesV2 } from '@telestar/core-scoring/rules/deriveQualification';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';
import type { RawScoringEvidence } from '@telestar/core-scoring/rules/evidence';

import { accountIdentityOf } from '@/lib/identity/resolveAccount';
import { prisma } from '@/lib/prisma';

// Scores a pool record against an ICP version, at import time.
//
// This is the gate the CRM has been missing. `CampaignLeadRequirement` measures adherence AFTER
// leads are converted, which reports on a problem rather than preventing it, and
// `LeadPoolItem.icpFitScore` has existed all along with nothing writing to it.
//
// Every run is recorded as a new `LeadPoolAssessment` and `latestAssessmentId` moves. Nothing is
// updated in place, so "why was this rejected in March" stays answerable after the rules change.

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

/** Maps the engine's verdict onto the database enum. */
const QUALIFICATION: Record<string, IcpQualification> = {
  QUALIFIED: 'qualified',
  // The engine distinguishes "the company fits but we have no usable contact" from "needs a human".
  // The database keeps three values, so it lands on needs_review: a record nobody can contact is
  // not qualified, and calling it unqualified would blame the company for a data gap.
  COMPANY_QUALIFIED_NEEDS_CONTACT: 'needs_review',
  NEEDS_REVIEW: 'needs_review',
  UNQUALIFIED: 'unqualified',
};

export type ScorePoolItemResult = {
  assessmentId: string;
  /** False when an identical assessment already existed and was reused. */
  inserted: boolean;
  fitScore: number;
  qualification: IcpQualification;
};

/**
 * Which ICP version scores this record: the campaign's, else the tenant's default profile's newest
 * published version. Null means nothing is configured, and the caller leaves the record NOT SCORED
 * rather than inventing rules for it.
 */
export async function resolveIcpVersionId(
  tenantId: string,
  campaignId: string | null
): Promise<string | null> {
  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { icpVersionId: true },
    });
    if (campaign?.icpVersionId) return campaign.icpVersionId;
  }

  const fallback = await prisma.icpVersion.findFirst({
    where: { tenantId, status: 'published', icpProfile: { isDefault: true } },
    orderBy: { versionNumber: 'desc' },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

export function buildScoringEvidence(
  item: ScorablePoolItem,
  intelligence?: { industryCategory: string | null; facts: string[]; summary: string | null } | null
): RawScoringEvidence {
  return {
    company: {
      companyName: item.company,
      industry: item.industry ?? undefined,
      industryCategory: intelligence?.industryCategory ?? undefined,
      country: item.country ?? undefined,
      // The engine keys on the domain, not the raw URL, and reuses the same normaliser the identity
      // writer does so a company scores against the same domain it was resolved by.
      domain: accountIdentityOf({ name: item.company, website: item.website }).canonicalDomain ?? undefined,
      websiteStatus: item.website ? 'reachable' : 'missing',
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
 * Hash of the inputs AND the rules.
 *
 * Both halves matter: the same record scores differently under different rules, and the same rules
 * score different records differently. Re-importing an unchanged file under unchanged rules
 * therefore reuses the existing assessment instead of appending an identical one — which is what
 * keeps an idempotent import idempotent all the way down to this table.
 */
export function assessmentFingerprint(evidence: RawScoringEvidence, rules: IcpVersionRulesV2): string {
  return createHash('sha256')
    .update(JSON.stringify({ evidence, rules }))
    .digest('hex');
}

export async function scorePoolItem(params: {
  tenantId: string;
  item: ScorablePoolItem;
  icpVersionId: string;
  rules: IcpVersionRulesV2;
  intelligence?: { industryCategory: string | null; facts: string[]; summary: string | null } | null;
}): Promise<ScorePoolItemResult> {
  const { tenantId, item, icpVersionId, rules } = params;

  const evidence = buildScoringEvidence(item, params.intelligence);
  const fingerprint = assessmentFingerprint(evidence, rules);

  const existing = await prisma.leadPoolAssessment.findFirst({
    where: { tenantId, poolItemId: item.id, fingerprint },
    select: { id: true, fitScore: true, qualification: true },
  });
  if (existing) {
    // Idempotent rerun: point at what is already there rather than writing a duplicate.
    await mirrorOntoPoolItem(prisma, {
      poolItemId: item.id,
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
  const qualification = QUALIFICATION[assessed.qualification] ?? 'needs_review';
  // The engine reports what evidence was missing; the share that was present is the data-quality
  // signal the console already has a column for.
  const dataQualityScore = Math.max(0, 100 - assessed.missingEvidence.length * 10);

  // One transaction: an assessment that exists while `latestAssessmentId` still points elsewhere
  // would show the console a score nobody can explain.
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
          reasonCodes: assessed.reasonCodes,
          accountPreRank: assessed.accountPreRank,
          confidenceBand: assessed.confidenceBand,
        } as unknown as Prisma.InputJsonValue,
        inputSnapshot: evidence as unknown as Prisma.InputJsonValue,
        rulesSnapshot: rules as unknown as Prisma.InputJsonValue,
        fingerprint,
      },
      select: { id: true },
    });

    await mirrorOntoPoolItem(tx, {
      poolItemId: item.id,
      assessmentId: row.id,
      fitScore: assessed.fitScore,
      dataQualityScore,
      qualification,
    });

    return row;
  });

  return { assessmentId: created.id, inserted: true, fitScore: assessed.fitScore, qualification };
}

/**
 * Copy the verdict onto the pool record.
 *
 * The assessment table is the source of truth; these columns exist so the leadgen console, its
 * filters and the CSV export read one row instead of joining. `qualification` on LeadPoolItem is
 * deliberately NOT touched — that one is a workflow state a reviewer owns, and a re-score must never
 * overwrite a human decision.
 */
async function mirrorOntoPoolItem(
  db: { leadPoolItem: { update: (args: any) => Promise<any> } },
  input: {
    poolItemId: string;
    assessmentId: string;
    fitScore: number;
    dataQualityScore: number | null;
    qualification: IcpQualification;
  }
): Promise<void> {
  await db.leadPoolItem.update({
    where: { id: input.poolItemId },
    data: {
      latestAssessmentId: input.assessmentId,
      icpFitScore: input.fitScore,
      icpQualification: input.qualification,
      ...(input.dataQualityScore === null ? {} : { dataQualityScore: input.dataQualityScore }),
    },
  });
}
