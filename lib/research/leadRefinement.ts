import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { rankLeads, type RankedLead } from '@/lib/leads/prioritization';
import { generateStructured, isGenerationAvailable } from '@/lib/ai/generation';
import { getEvidenceForLead } from './engine';
import { validateEvidenceCitations } from './grounded-copy';

/**
 * AI refinement of a deterministic ranking (Phase 8a).
 *
 * ```text
 * rankLeads()  →  every candidate, deterministic score, authoritative order
 *              →  bounded top slice (≤ MAX_AI_REFINED_LEADS)
 *              →  ONE model call for the whole slice
 *              →  rationale attached to leads whose citations validate
 * ```
 *
 * Never one call per lead, and never a model-invented score. The model receives the scores the
 * CRM computed and explains the ordering; `score`, `label` and `rank` are copied through
 * untouched, so a hallucinated number has nowhere to land.
 *
 * ## What "refined" counts
 *
 * `refinedCount` is the number of leads that came back with a **validated** rationale. A lead
 * the model skipped, or whose citations failed validation, is not refined. The earlier version
 * incremented per attempted row, so an API with no evidence and no model reported ten enriched
 * leads and zero enrichment.
 *
 * ## Degradation
 *
 * No key, provider down, unparseable output: `aiRefined` is false, `refinedCount` is 0, and the
 * deterministic ranking returns exactly as it would have. Nothing is invented to fill the gap.
 */

/** Hard ceiling on how many leads one refinement pass may cover. */
export const MAX_AI_REFINED_LEADS = 10;

export interface RefinedLead extends RankedLead {
  /** Model-written rationale, grounded in cited evidence. Absent when refinement did not run. */
  aiRationale?: string;
  /** Model-suggested next objective. Absent when refinement did not run. */
  suggestedObjective?: string;
  /** Evidence ids the rationale rests on. Empty when it asserts no prospect facts. */
  citedEvidenceIds: string[];
}

export interface PrioritizationResult {
  leads: RefinedLead[];
  rankedCount: number;
  /** Leads that came back with a validated rationale. Never more than the slice size. */
  refinedCount: number;
  /** True when a model call succeeded. */
  aiRefined: boolean;
  /** True when refinement was skipped or failed — the ranking is unaffected either way. */
  degraded: boolean;
  degradedReason?: string;
  /** Provenance for the refinement call, when one was made. */
  aiCallId?: string | null;
}

export interface PrioritizeInput {
  tenantId: string;
  campaignId?: string | null;
  limit?: number;
  /** How many top leads to refine. Clamped to `MAX_AI_REFINED_LEADS`. */
  refineLimit?: number;
  workOrderId?: string | null;
  agentActionId?: string | null;
}

interface ModelRationale {
  leadId: string;
  rationale: string;
  nextObjective?: string;
  citedEvidenceIds?: string[];
}

export async function prioritizeLeadsWithRefinement(
  user: SessionUser,
  input: PrioritizeInput
): Promise<PrioritizationResult> {
  const ranked = await rankLeads(user, {
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    limit: input.limit,
  });

  const refineLimit = Math.max(
    0,
    Math.min(input.refineLimit ?? MAX_AI_REFINED_LEADS, MAX_AI_REFINED_LEADS)
  );
  const slice = ranked.slice(0, refineLimit);

  const base: RefinedLead[] = ranked.map((lead) => ({ ...lead, citedEvidenceIds: [] }));

  if (slice.length === 0) {
    return {
      leads: base,
      rankedCount: ranked.length,
      refinedCount: 0,
      aiRefined: false,
      degraded: true,
      degradedReason: 'no leads selected for refinement',
    };
  }

  if (!isGenerationAvailable()) {
    return {
      leads: base,
      rankedCount: ranked.length,
      refinedCount: 0,
      aiRefined: false,
      degraded: true,
      degradedReason: 'no generation provider configured',
    };
  }

  // Evidence for the slice only. Facts the model may assert come from here and nowhere else.
  const evidenceByLead = new Map<string, { id: string; text: string }[]>();
  for (const lead of slice) {
    const evidence = await getEvidenceForLead(input.tenantId, lead.leadId);
    evidenceByLead.set(lead.leadId, [
      ...evidence.companySignals.map((s) => ({ id: s.id, text: `signal: ${s.summary}` })),
      ...evidence.accountPainHypotheses.map((p) => ({ id: p.id, text: `pain: ${p.hypothesis}` })),
      ...evidence.personalizationHooks.map((h) => ({ id: h.id, text: `hook: ${h.angle}` })),
    ]);
  }

  const prompt = buildRefinementPrompt(slice, evidenceByLead);

  const outcome = await generateStructured<ModelRationale[]>(
    {
      tenantId: input.tenantId,
      userId: user.id,
      workOrderId: input.workOrderId ?? null,
      agentActionId: input.agentActionId ?? null,
      operation: 'prioritization',
      systemPrompt: REFINEMENT_SYSTEM_PROMPT,
      userPrompt: prompt,
      maxOutputTokens: 900,
    },
    parseRationales
  );

  if (!outcome.available || !outcome.data) {
    return {
      leads: base,
      rankedCount: ranked.length,
      refinedCount: 0,
      aiRefined: false,
      degraded: true,
      degradedReason: outcome.reason ?? 'refinement unavailable',
      aiCallId: outcome.aiCallId,
    };
  }

  const allowed = new Set(slice.map((lead) => lead.leadId));
  let refinedCount = 0;

  for (const rationale of outcome.data) {
    if (!allowed.has(rationale.leadId)) continue; // A lead outside the slice is not ours to touch.

    const target = base.find((lead) => lead.leadId === rationale.leadId);
    if (!target) continue;

    const offered = new Set((evidenceByLead.get(rationale.leadId) ?? []).map((e) => e.id));
    const cited = rationale.citedEvidenceIds ?? [];

    // A citation the model was never offered — invented, or belonging to evidence that has since
    // gone stale — disqualifies the whole rationale. Keeping the prose and dropping the citation
    // is how an unsupported claim survives with its evidence quietly removed.
    if (cited.some((id) => !offered.has(id))) continue;

    if (cited.length > 0) {
      const lead = await prisma.lead.findUnique({
        where: { id: rationale.leadId },
        select: { accountId: true, contactId: true },
      });
      const validation = await validateEvidenceCitations(
        input.tenantId,
        { accountId: lead?.accountId ?? null, contactId: lead?.contactId ?? null, leadId: rationale.leadId },
        cited
      );
      // A rationale citing evidence that does not validate is dropped whole. Keeping the prose
      // and discarding the citation is how an unsupported claim survives.
      if (!validation.valid) continue;
    }

    target.aiRationale = rationale.rationale;
    target.suggestedObjective = rationale.nextObjective;
    target.citedEvidenceIds = cited;
    refinedCount += 1;
  }

  return {
    leads: base,
    rankedCount: ranked.length,
    refinedCount,
    aiRefined: refinedCount > 0,
    degraded: refinedCount === 0,
    degradedReason: refinedCount === 0 ? 'model returned no usable rationale' : undefined,
    aiCallId: outcome.aiCallId,
  };
}

export const REFINEMENT_SYSTEM_PROMPT = [
  'You explain an SDR lead ranking that has already been computed by the CRM.',
  'The score, label and rank are facts you must not change, contradict or recompute.',
  'You may only state a fact about a prospect if it appears in that lead\'s EVIDENCE list, and you must cite the evidence id you used.',
  'If a lead has no evidence, write a rationale from the CRM signals given and cite nothing.',
  'Reply with JSON: {"leads":[{"leadId":"...","rationale":"...","nextObjective":"...","citedEvidenceIds":["..."]}]}',
].join(' ');

/** Exported so a test can assert what actually reaches the model. */
export function buildRefinementPrompt(
  slice: RankedLead[],
  evidenceByLead: Map<string, { id: string; text: string }[]>
): string {
  const blocks = slice.map((lead) => {
    const evidence = evidenceByLead.get(lead.leadId) ?? [];
    const evidenceText = evidence.length
      ? evidence.map((e) => `  - [${e.id}] ${e.text}`).join('\n')
      : '  - (none)';
    return [
      `LEAD ${lead.leadId}`,
      `  name: ${lead.firstName} ${lead.lastName}`,
      `  company: ${lead.company}`,
      `  title: ${lead.title ?? 'unknown'}`,
      `  crm score: ${lead.score} (${lead.label}), rank ${lead.rank}`,
      `  crm signals: ${lead.insights.join('; ')}`,
      '  EVIDENCE:',
      evidenceText,
    ].join('\n');
  });

  return `Explain this ranking. Do not reorder it.\n\n${blocks.join('\n\n')}`;
}

function parseRationales(raw: string): ModelRationale[] | null {
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { leads?: unknown })?.leads;
  if (!Array.isArray(list)) return null;

  const rationales = list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      leadId: String(item.leadId ?? ''),
      rationale: String(item.rationale ?? ''),
      nextObjective: item.nextObjective ? String(item.nextObjective) : undefined,
      citedEvidenceIds: Array.isArray(item.citedEvidenceIds)
        ? item.citedEvidenceIds.map(String)
        : [],
    }))
    .filter((item) => item.leadId && item.rationale);

  return rationales.length > 0 ? rationales : null;
}
