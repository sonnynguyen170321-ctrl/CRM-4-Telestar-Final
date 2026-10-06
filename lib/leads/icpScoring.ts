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
  deriveIcpVerdict,
  resolveIcpVersionId,
  verdictEvidence,
} from '@/lib/leadgen/scorePoolItem';

export type ScoreLeadIcpResult =
  | { status: 'scored'; assessmentId: string; inserted: boolean; fitScore: number; qualification: IcpQualification }
  | { status: 'not_scored'; reason: 'lead_not_found' | 'no_icp_configured' | 'icp_version_unreadable' };

/** The lead fields the engine reads, with company facts pulled from the account when present. */
export const SCORABLE_LEAD_SELECT = {
  id: true,
  tenantId: true,
  company: true,
  title: true,
  email: true,
  campaignId: true,
  contact: { select: { country: true } },
  account: {
    select: { id: true, industry: true, country: true, website: true, size: true, staffCountMin: true, staffCountMax: true },
  },
} satisfies Prisma.LeadSelect;

export type ScorableLead = Prisma.LeadGetPayload<{ select: typeof SCORABLE_LEAD_SELECT }>;


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

  const intelligence = (await loadScoringIntelligence(tenantId, [lead.account?.id])).get(lead.account?.id ?? '') ?? null;
  const evidence = buildScoringEvidence(toScorable(lead), intelligence);
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
  const verdict = deriveIcpVerdict(assessed, rules, evidence);
  const { qualification, fitScore } = verdict;
  const dataQualityScore = Math.max(0, 100 - assessed.missingEvidence.length * 10);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.leadIcpAssessment.create({
        data: {
          tenantId,
          leadId: lead.id,
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
      await pointLeadAt(tx, { leadId: lead.id, icpVersionId, assessmentId: row.id, fitScore, qualification });
      return row;
    });
    return { status: 'scored', assessmentId: created.id, inserted: true, fitScore, qualification };
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

/** The engine's view of a lead. Shared with the ICP live preview so both read leads identically. */
export type ScoringIntelligence = { industryCategory: string | null; facts: string[]; summary: string | null };

/**
 * What the company research found, per account, for the scoring evidence. Leads were scored on the
 * account's industry string alone — the description and research facts `buildScoringEvidence`
 * accepts were never passed (2026-10-06), so the services check and industry matching saw one line
 * of text. Latest usable profile per account; batched for the previews.
 */
export async function loadScoringIntelligence(tenantId: string, accountIds: Array<string | null | undefined>): Promise<Map<string, ScoringIntelligence>> {
  const ids = [...new Set(accountIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const profiles = await prisma.companyIntelligenceProfile.findMany({
    where: { tenantId, accountId: { in: ids }, profileStatus: { in: ['extracted', 'partial'] } },
    orderBy: { createdAt: 'desc' },
    select: { accountId: true, industryCategory: true, companySummary: true, factsJson: true },
  });
  const out = new Map<string, ScoringIntelligence>();
  for (const p of profiles) {
    if (out.has(p.accountId)) continue;
    out.set(p.accountId, {
      industryCategory: p.industryCategory,
      summary: p.companySummary,
      facts: Array.isArray(p.factsJson) ? (p.factsJson as unknown[]).filter((f): f is string => typeof f === 'string') : [],
    });
  }
  return out;
}

export function toScorable(lead: ScorableLead) {
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
    employeeCount: headcountOf(lead.account),
  };
}

/**
 * The account's headcount, from whatever the import recorded.
 *
 * Every lead used to reach the engine with no size at all, though imports write `Account.size` and
 * the staff-count range: the TeleStar ICP's "minimum 3 employees" therefore read as unknown on every
 * lead. A range contributes its midpoint only when both ends are known; a lone minimum is used as
 * is, since it is a floor the company already clears.
 */
function headcountOf(
  account: { size: number | null; staffCountMin: number | null; staffCountMax: number | null } | null | undefined
): number | null {
  if (!account) return null;
  if (account.size != null && account.size > 0) return account.size;
  if (account.staffCountMin != null && account.staffCountMax != null) {
    return Math.round((account.staffCountMin + account.staffCountMax) / 2);
  }
  if (account.staffCountMin != null && account.staffCountMin > 0) return account.staffCountMin;
  return null;
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

/**
 * What a rescore would do to one lead, without doing it.
 *
 * The same load, evidence and verdict as `scoreLeadIcp`, and no write of any kind. It exists for
 * the moment the verdict rule changes: a manager has to see "142 leads move from No fit to Review,
 * 9 from Fit to Review" before they move, because SDRs have already worked lists built from the
 * old verdicts and an unannounced reshuffle is how a queue loses its owner's trust.
 */
export async function previewLeadIcp(params: {
  tenantId: string;
  leadId: string;
}): Promise<
  | {
      status: 'previewed';
      from: IcpQualification | null;
      to: IcpQualification;
      fitScore: number;
      /** A person has given this lead a verdict, which a new score cannot move (lib/leads/effectiveQualification.ts). */
      pinned: boolean;
    }
  | { status: 'not_scored'; reason: 'lead_not_found' | 'no_icp_configured' | 'icp_version_unreadable' }
> {
  const { tenantId, leadId } = params;
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { ...SCORABLE_LEAD_SELECT, icpQualification: true, qualificationOverride: true },
  });
  if (!lead) return { status: 'not_scored', reason: 'lead_not_found' };

  const icpVersionId = await resolveIcpVersionId(tenantId, lead.campaignId ?? null);
  if (!icpVersionId) return { status: 'not_scored', reason: 'no_icp_configured' };
  const version = await prisma.icpVersion.findFirst({ where: { id: icpVersionId, tenantId }, select: { rulesJson: true } });
  if (!version?.rulesJson) return { status: 'not_scored', reason: 'icp_version_unreadable' };
  const rules = version.rulesJson as unknown as IcpVersionRulesV2;

  const intelligence = (await loadScoringIntelligence(tenantId, [lead.account?.id])).get(lead.account?.id ?? '') ?? null;
  const evidence = buildScoringEvidence(toScorable(lead), intelligence);
  const verdict = deriveIcpVerdict(assessIcpRulesV2(evidence, rules), rules, evidence);
  return {
    status: 'previewed',
    from: lead.icpQualification ?? null,
    to: verdict.qualification,
    fitScore: verdict.fitScore,
    pinned: lead.qualificationOverride != null,
  };
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
  /** Pass back as `cursor` to continue after this batch; null when there is nothing after it. */
  nextCursor: string | null;
  /** Dry run only: nothing was written. */
  dryRun?: boolean;
  /**
   * Dry run only: verdict moves, keyed "from→to" ("unscored" for a lead with no verdict yet).
   * Leads whose verdict would not change are counted under `unchanged`.
   */
  transitions?: Record<string, number>;
  unchanged?: number;
  /** Dry run only: leads a person has given a verdict — what they act on would not move. */
  pinned?: number;
};

function decodeRescoreCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf('|');
  const createdAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (sep < 1 || !id || Number.isNaN(createdAt.getTime())) throw new Error('Invalid rescore cursor');
  return { createdAt, id };
}

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
  /** `nextCursor` from the previous batch. */
  cursor?: string;
  /** Report what would change and write nothing. */
  dryRun?: boolean;
}): Promise<RescoreLeadsReport> {
  const { tenantId, campaignId } = params;
  const onlyUnscored = params.onlyUnscored ?? true;
  const limit = Math.min(params.limit ?? RESCORE_LEADS_BATCH_LIMIT, RESCORE_LEADS_BATCH_LIMIT);

  // Keyset pagination. "Repeat the call" used to re-read the same first batch: with
  // `onlyUnscored: false` every lead still matches, so a 1,692-lead campaign never got past lead
  // 500 (2026-10-07). With `onlyUnscored` a lead that stays NOT SCORED also kept its place.
  const after = decodeRescoreCursor(params.cursor);
  const targets = await prisma.lead.findMany({
    where: {
      tenantId,
      archivedAt: null,
      ...(campaignId ? { campaignId } : {}),
      ...(onlyUnscored ? { latestIcpAssessmentId: null } : {}),
      ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}),
    },
    select: { id: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const truncated = targets.length > limit;
  const batch = targets.slice(0, limit);
  const last = batch.at(-1);
  const nextCursor = truncated && last ? `${last.createdAt.toISOString()}|${last.id}` : null;

  const report: RescoreLeadsReport = { considered: batch.length, scored: 0, notScored: 0, reasons: {}, truncated, nextCursor };

  if (params.dryRun) {
    report.dryRun = true;
    report.transitions = {};
    report.unchanged = 0;
    report.pinned = 0;
    for (const target of batch) {
      const preview = await previewLeadIcp({ tenantId, leadId: target.id });
      if (preview.status !== 'previewed') {
        report.notScored += 1;
        report.reasons[preview.reason] = (report.reasons[preview.reason] ?? 0) + 1;
        continue;
      }
      report.scored += 1;
      if (preview.pinned) {
        report.pinned += 1;
        continue;
      }
      if (preview.from === preview.to) {
        report.unchanged += 1;
        continue;
      }
      const key = `${preview.from ?? 'unscored'}→${preview.to}`;
      report.transitions[key] = (report.transitions[key] ?? 0) + 1;
    }
    return report;
  }

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
