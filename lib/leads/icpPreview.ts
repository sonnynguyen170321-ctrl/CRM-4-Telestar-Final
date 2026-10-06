import type { IcpQualification } from '@prisma/client';
import { assessIcpRulesV2 } from '@telestar/core-scoring/rules/deriveQualification';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import { buildScoringEvidence } from '@/lib/leadgen/scorePoolItem';
import { deriveIcpVerdict, type PointMatch } from '@/lib/leadgen/pointsQualification';
import { SCORABLE_LEAD_SELECT, loadScoringIntelligence, toScorable } from '@/lib/leads/icpScoring';
import { prisma } from '@/lib/prisma';

/**
 * Live preview for the scoring editor: what unsaved rules would do to real leads.
 *
 * The operator asked to "see the result on real leads while editing". This scores a bounded
 * sample against the *draft* rules in memory and returns the distribution, the verdict moves, and a
 * handful of example leads. It writes nothing — no assessment, no mirror, no audit row — so it can
 * run on every edit.
 *
 * The sample is the leads this ICP actually scores (campaigns assigned to any version of the
 * profile); when that is too small to say anything, it widens to the tenant's most recent leads,
 * and says so in `scope`. Tenant-bound on every read.
 */

export const PREVIEW_SAMPLE_LIMIT = 200;
const MIN_SCOPED_SAMPLE = 20;
const EXAMPLE_COUNT = 12;

type Counts = { qualified: number; needs_review: number; unqualified: number };
type Before = Counts & { unscored: number };

export type IcpPreviewResult = {
  sampleSize: number;
  scope: 'icp_campaigns' | 'recent_leads';
  before: Before;
  after: Counts;
  /** "from→to" for every lead whose verdict would change; "unscored" when it had none. */
  moves: Record<string, number>;
  /**
   * Leads a person has given a verdict: a new score cannot move them (lib/leads/effectiveQualification.ts),
   * so they count the same before and after and are never in `moves`.
   */
  pinned: number;
  examples: Array<{
    leadId: string;
    name: string;
    company: string;
    title: string | null;
    before: { qualification: IcpQualification | null; fitScore: number | null };
    after: { qualification: IcpQualification; fitScore: number; points: number | null; matches: PointMatch[] };
  }>;
};

const RANK: Record<IcpQualification, number> = { qualified: 2, needs_review: 1, unqualified: 0 };

export async function previewIcpRules(input: {
  tenantId: string;
  icpProfileId: string;
  rules: IcpVersionRulesV2;
}): Promise<IcpPreviewResult> {
  const { tenantId, icpProfileId, rules } = input;
  const select = {
    ...SCORABLE_LEAD_SELECT,
    firstName: true,
    lastName: true,
    icpQualification: true,
    icpFitScore: true,
    qualificationOverride: true,
  } as const;

  let scope: IcpPreviewResult['scope'] = 'icp_campaigns';
  let leads = await prisma.lead.findMany({
    where: { tenantId, archivedAt: null, campaign: { icpVersion: { icpProfileId } } },
    select,
    orderBy: { createdAt: 'desc' },
    take: PREVIEW_SAMPLE_LIMIT,
  });
  if (leads.length < MIN_SCOPED_SAMPLE) {
    scope = 'recent_leads';
    leads = await prisma.lead.findMany({
      where: { tenantId, archivedAt: null },
      select,
      orderBy: { createdAt: 'desc' },
      take: PREVIEW_SAMPLE_LIMIT,
    });
  }

  const before: Before = { qualified: 0, needs_review: 0, unqualified: 0, unscored: 0 };
  const after: Counts = { qualified: 0, needs_review: 0, unqualified: 0 };
  const moves: Record<string, number> = {};
  let pinned = 0;
  const scored: Array<IcpPreviewResult['examples'][number] & { change: number }> = [];

  const intelligence = await loadScoringIntelligence(tenantId, leads.map((l) => l.account?.id));
  for (const lead of leads) {
    if (lead.qualificationOverride) {
      before[lead.qualificationOverride] += 1;
      after[lead.qualificationOverride] += 1;
      pinned += 1;
      continue;
    }
    const evidence = buildScoringEvidence(toScorable(lead), intelligence.get(lead.account?.id ?? '') ?? null);
    const verdict = deriveIcpVerdict(assessIcpRulesV2(evidence, rules), rules, evidence);

    if (lead.icpQualification) before[lead.icpQualification] += 1;
    else before.unscored += 1;
    after[verdict.qualification] += 1;

    if (lead.icpQualification !== verdict.qualification) {
      const key = `${lead.icpQualification ?? 'unscored'}→${verdict.qualification}`;
      moves[key] = (moves[key] ?? 0) + 1;
    }

    const verdictChange = lead.icpQualification
      ? Math.abs(RANK[verdict.qualification] - RANK[lead.icpQualification]) * 100
      : 50;
    scored.push({
      leadId: lead.id,
      name: `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || lead.company,
      company: lead.company,
      title: lead.title ?? null,
      before: { qualification: lead.icpQualification ?? null, fitScore: lead.icpFitScore ?? null },
      after: {
        qualification: verdict.qualification,
        fitScore: verdict.fitScore,
        points: verdict.points?.total ?? null,
        matches: verdict.points?.matches ?? [],
      },
      // Verdict moves first, then the biggest score moves: the leads worth looking at.
      change: verdictChange + Math.abs(verdict.fitScore - (lead.icpFitScore ?? verdict.fitScore)),
    });
  }

  const examples = scored
    .sort((a, b) => b.change - a.change)
    .slice(0, EXAMPLE_COUNT)
    .map(({ change: _change, ...example }) => example);

  return { sampleSize: leads.length, scope, before, after, moves, pinned, examples };
}
