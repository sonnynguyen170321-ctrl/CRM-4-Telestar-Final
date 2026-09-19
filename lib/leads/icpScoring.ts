/**
 * ICP scoring for a CRM lead.
 *
 * Until 2026-09-19 the ICP engine could only write to `LeadPoolItem`. A lead an SDR uploaded
 * through Import CSV, created by hand, converted from the pool or pushed through the v1 API had
 * no `icpFitScore`, no assessment row and nowhere to put one; on production 987 of 1,138 leads
 * carried no score of any kind and the team was filtering ICP fit in Excel before upload.
 *
 * This is the pool runtime with a different subject. The pure parts are imported from
 * `lib/leadgen/scorePoolItem.ts` rather than copied — one engine, one evidence shape, one
 * fingerprint — so a lead and a pool record with the same fields get the same verdict, and a
 * rule change lands on both. Only the persistence differs: `LeadIcpAssessment` instead of
 * `LeadPoolAssessment`, and the mirror on `Lead` instead of `LeadPoolItem`.
 *
 * Contract, same as the pool's:
 *   - NOT SCORED is honest. No ICP for the campaign → fields stay null, no row, and the caller
 *     is told why. Never a fake zero.
 *   - insert-only. A re-score under identical evidence and rules reuses the row; under changed
 *     evidence or rules it appends and moves the pointer. "Why was this lead rejected in March"
 *     stays answerable after the rules have changed twice.
 *   - the mirror on the lead moves in the same transaction as the assessment.
 *   - tenant-scoped by the extension on every read and write; a foreign lead id resolves to
 *     nothing.
 */
import type { IcpQualification, Prisma } from '@prisma/client';
import { assessIcpRulesV2 } from '@telestar/core-scoring/rules/deriveQualification';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import { prisma } from '@/lib/prisma';
import {
  assessmentFingerprint,
  buildScoringEvidence,
  deriveSimpleIcpQualification,
  resolveIcpVersionId,
} from '@/lib/leadgen/scorePoolItem';

export type ScoreLeadIcpResult =
  | { status: 'scored'; assessmentId: string; inserted: boolean; fitScore: number; qualification: IcpQualification }
  | { status: 'not_scored'; reason: 'lead_not_found' | 'no_icp_configured' | 'icp_version_unreadable' };

/** The lead fields the engine reads, with company facts pulled from the account when present. */
const SCORABLE_LEAD_SELECT = {
  id: true,
  tenantId: true,
  company: true,
  title: true,
  email: true,
  campaignId: true,
  contact: { select: { country: true } },
  account: { select: { id: true, industry: true, country: true, website: true } },
} satisfies Prisma.LeadSelect;

type ScorableLead = Prisma.LeadGetPayload<{ select: typeof SCORABLE_LEAD_SELECT }>;

function simpleQualificationReason(qualification: IcpQualification): string {
  if (qualification === 'unqualified') return 'simple_known_mismatch';
  if (qualification === 'needs_review') return 'simple_missing_evidence';
  return 'simple_all_must_haves_pass';
}

/**
 * Score one lead against the ICP its campaign carries (or the tenant default).
 *
 * Reads and writes go through the tenant-scoped client, so `leadId` from another tenant is
 * simply not found. `tenantId` is still taken explicitly so a worker without request context
 * can call this inside `tenantStorage.run`.
 */
export async function scoreLeadIcp(params: { tenantId: string; leadId: string }): Promise<ScoreLeadIcpResult> {
  const { tenantId, leadId } = params;

  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: SCORABLE_LEAD_SELECT });
  if (!lead) return { status: 'not_scored', reason: 'lead_not_found' };

  const icpVersionId = await resolveIcpVersionId(tenantId, lead.campaignId ?? null);
  if (!icpVersionId) return { status: 'not_scored', reason: 'no_icp_configured' };

  const version = await prisma.icpVersion.findFirst({ where: { id: icpVersionId, tenantId }, select: { rulesJson: true } });
  if (!version?.rulesJson) return { status: 'not_scored', reason: 'icp_version_unreadable' };
  const rules = version.rulesJson as unknown as IcpVersionRulesV2;

  const evidence = buildScoringEvidence(toScorable(lead));
  const fingerprint = assessmentFingerprint(evidence, rules, icpVersionId);

  const existing = await prisma.leadIcpAssessment.findFirst({
    where: { tenantId, leadId: lead.id, icpVersionId, fingerprint },
    select: { id: true, fitScore: true, qualification: true },
  });
  if (existing) {
    await pointLeadAt(prisma, { leadId: lead.id, icpVersionId, assessmentId: existing.id, fitScore: existing.fitScore, qualification: existing.qualification });
    return { status: 'scored', assessmentId: existing.id, inserted: false, fitScore: existing.fitScore, qualification: existing.qualification };
  }

  const assessed = assessIcpRulesV2(evidence, rules);
  const qualification = deriveSimpleIcpQualification(assessed, rules, evidence);
  const dataQualityScore = Math.max(0, 100 - assessed.missingEvidence.length * 10);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.leadIcpAssessment.create({
        data: {
          tenantId,
          leadId: lead.id,
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
            weightedDiagnostics: { qualification: assessed.qualification, reasonCodes: assessed.reasonCodes },
            accountPreRank: assessed.accountPreRank,
            confidenceBand: assessed.confidenceBand,
          } as unknown as Prisma.InputJsonValue,
          inputSnapshot: evidence as unknown as Prisma.InputJsonValue,
          rulesSnapshot: rules as unknown as Prisma.InputJsonValue,
          fingerprint,
        },
        select: { id: true },
      });
      await pointLeadAt(tx, { leadId: lead.id, icpVersionId, assessmentId: row.id, fitScore: assessed.fitScore, qualification });
      return row;
    });
    return { status: 'scored', assessmentId: created.id, inserted: true, fitScore: assessed.fitScore, qualification };
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'P2002') throw error;
    // Two callers missed the optimistic lookup together — an import chunk and a rescore, say.
    // The unique fingerprint chose one immutable row; the loser converges on it.
    const raced = await prisma.leadIcpAssessment.findFirst({
      where: { tenantId, leadId: lead.id, icpVersionId, fingerprint },
      select: { id: true, fitScore: true, qualification: true },
    });
    if (!raced) throw error;
    await pointLeadAt(prisma, { leadId: lead.id, icpVersionId, assessmentId: raced.id, fitScore: raced.fitScore, qualification: raced.qualification });
    return { status: 'scored', assessmentId: raced.id, inserted: false, fitScore: raced.fitScore, qualification: raced.qualification };
  }
}

function toScorable(lead: ScorableLead) {
  return {
    id: lead.id,
    company: lead.company,
    title: lead.title ?? null,
    email: lead.email ?? null,
    // The contact's country is where the person sits; the account's is where the company is.
    // The engine's geography rules are about the company, so the account wins when both exist.
    country: lead.account?.country ?? lead.contact?.country ?? null,
    industry: lead.account?.industry ?? null,
    website: lead.account?.website ?? null,
    accountId: lead.account?.id ?? null,
  };
}

async function pointLeadAt(
  db: { lead: { update: (args: Prisma.LeadUpdateArgs) => Promise<unknown> } },
  input: { leadId: string; icpVersionId: string; assessmentId: string; fitScore: number; qualification: IcpQualification }
): Promise<void> {
  await db.lead.update({
    where: { id: input.leadId },
    data: {
      latestIcpAssessmentId: input.assessmentId,
      icpVersionId: input.icpVersionId,
      icpFitScore: input.fitScore,
      icpQualification: input.qualification,
      icpScoredAt: new Date(),
    },
  });
}

export const RESCORE_LEADS_BATCH_LIMIT = 500;

export type RescoreLeadsReport = {
  considered: number;
  scored: number;
  notScored: number;
  /** Why the not-scored ones were not, so an operator can tell "no ICP" from "cannot read ICP". */
  reasons: Record<string, number>;
  /** True when the batch limit cut the run short and another call is needed. */
  truncated: boolean;
};

/**
 * Score many leads, bounded, for the rescore endpoint and the backfill script.
 *
 * `onlyUnscored` (the default) is what a backfill and a nightly sweep want: leads that carry
 * no verdict yet. `onlyUnscored: false` re-runs everything in scope — after a rules change,
 * say — and relies on the fingerprint to make the untouched ones free.
 */
export async function rescoreLeadsIcp(params: {
  tenantId: string;
  campaignId?: string;
  onlyUnscored?: boolean;
  limit?: number;
}): Promise<RescoreLeadsReport> {
  const { tenantId, campaignId } = params;
  const onlyUnscored = params.onlyUnscored ?? true;
  const limit = Math.min(params.limit ?? RESCORE_LEADS_BATCH_LIMIT, RESCORE_LEADS_BATCH_LIMIT);

  const targets = await prisma.lead.findMany({
    where: {
      tenantId,
      archivedAt: null,
      ...(campaignId ? { campaignId } : {}),
      ...(onlyUnscored ? { latestIcpAssessmentId: null } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: limit + 1,
  });
  const truncated = targets.length > limit;
  const batch = targets.slice(0, limit);

  const report: RescoreLeadsReport = { considered: batch.length, scored: 0, notScored: 0, reasons: {}, truncated };
  for (const target of batch) {
    const result = await scoreLeadIcp({ tenantId, leadId: target.id });
    if (result.status === 'scored') report.scored += 1;
    else {
      report.notScored += 1;
      report.reasons[result.reason] = (report.reasons[result.reason] ?? 0) + 1;
    }
  }
  return report;
}
