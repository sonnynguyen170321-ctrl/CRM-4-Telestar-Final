import {
  MAX_CANDIDATES_PER_CALL,
  buildFitPrompt,
  parseFitResponse,
  type AiFit,
} from '@telestar/core-research/fitPrompt';
import { OFF_PERSONA_SCORE_CAP } from '@telestar/core-research/scoreCandidates';

import { generateStructured, type GenerationOutcome } from '@/lib/ai/generation';
import { prisma } from '@/lib/prisma';

/**
 * The AI-fit layer for research candidates.
 *
 * `ResearchBuilderParams.aiFit` and `buildFitPrompt` both existed and nothing connected them: the
 * toggle was parsed and ignored, and every candidate was scored by keyword count. This is the
 * connection. It runs after the deterministic score, on the candidates one discovery pass created,
 * and only when the run asked for it.
 *
 * Three rules, each there because the alternative misleads someone:
 *
 *   - **Advisory and never fatal.** No provider, a failed call or unparseable output leaves the
 *     heuristic score in place and the pass carries on. A run must not fail because an optional
 *     re-rank could not run.
 *   - **Bounded.** At most `MAX_AI_CANDIDATES_PER_PASS` per pass, in calls of `MAX_CANDIDATES_PER_CALL`.
 *     A 1,000-query run would otherwise be an unbounded bill decided by a checkbox.
 *   - **Refines, never replaces.** The result stays within `AI_REFINE_WINDOW` of the heuristic.
 *   - **Cannot overrule the persona floor.** A contact whose title the heuristic already found
 *     outside every searched persona stays at or below `OFF_PERSONA_SCORE_CAP` whatever the model
 *     says. The model is told the same rule; this is what holds if it does not listen.
 */

export const MAX_AI_CANDIDATES_PER_PASS = 90;

/**
 * How far the model may move a candidate from its deterministic score, either way.
 *
 * `ResearchCandidate.fitSource` is documented as "the deterministic score is the baseline; AI may
 * only refine it within a bounded window, never replace it". Twenty-five points is enough to reorder
 * a list — lift a strong on-persona match into the eighties, sink a junk page into the thirties — and
 * not enough for one confident hallucination to turn a 30 into a 95.
 */
export const AI_REFINE_WINDOW = 25;

export type AiFitCandidate = {
  id: string;
  name: string;
  title: string | null;
  companyName: string | null;
  domain: string | null;
  snippet: string | null;
  /** The heuristic placed this contact outside every searched persona. */
  offPersona: boolean;
  /** The deterministic score the AI refines within `AI_REFINE_WINDOW`. */
  heuristicScore: number;
};

type GenerateFn = (
  input: Parameters<typeof generateStructured<Map<number, AiFit>>>[0],
  parse: (raw: string) => Map<number, AiFit> | null
) => Promise<GenerationOutcome<Map<number, AiFit>>>;

export type AiFitResult = { scored: number; attempted: number; unavailableReason: string | null };

export async function applyAiFit(
  input: {
    tenantId: string;
    runId: string;
    kind: 'company' | 'contact';
    targetSignals: string[];
    personaTitles: string[];
    candidates: AiFitCandidate[];
  },
  deps: { generate?: GenerateFn } = {}
): Promise<AiFitResult> {
  const generate = deps.generate ?? (generateStructured as GenerateFn);
  const pool = input.candidates.slice(0, MAX_AI_CANDIDATES_PER_PASS);
  let scored = 0;
  let unavailableReason: string | null = null;

  for (let start = 0; start < pool.length; start += MAX_CANDIDATES_PER_CALL) {
    const batch = pool.slice(start, start + MAX_CANDIDATES_PER_CALL);
    const prompt = buildFitPrompt(
      input.kind === 'contact' ? 'CONTACT' : 'COMPANY',
      input.targetSignals,
      batch,
      input.personaTitles
    );

    let outcome: GenerationOutcome<Map<number, AiFit>>;
    try {
      outcome = await generate(
        {
          tenantId: input.tenantId,
          researchRunId: input.runId,
          operation: 'research_fit',
          systemPrompt:
            'You score B2B prospecting candidates against an ideal customer profile. Answer with JSON only. ' +
            'Use only the evidence given; do not invent facts about a company or person.',
          userPrompt: prompt,
          maxOutputTokens: 1800,
        },
        (raw) => {
          const parsed = parseFitResponse(raw, batch.length);
          return parsed.size > 0 ? parsed : null;
        }
      );
    } catch (error) {
      console.error('[research] AI fit call failed', { runId: input.runId, error });
      unavailableReason = error instanceof Error ? error.message : String(error);
      break;
    }

    if (!outcome.available || !outcome.data) {
      // The heuristic score stays. Stop here rather than paying for more calls that will fail the
      // same way — an unconfigured provider is not going to be configured by the next batch.
      unavailableReason = outcome.reason ?? 'AI fit unavailable';
      break;
    }

    for (const [index, fit] of outcome.data) {
      const candidate = batch[index];
      if (!candidate) continue;
      const bounded = Math.max(
        candidate.heuristicScore - AI_REFINE_WINDOW,
        Math.min(candidate.heuristicScore + AI_REFINE_WINDOW, fit.fitScore)
      );
      const capped = candidate.offPersona ? Math.min(bounded, OFF_PERSONA_SCORE_CAP) : bounded;
      const score = Math.max(0, Math.min(100, Math.round(capped)));
      const reason = candidate.offPersona
        ? `Off-persona title "${candidate.title ?? ''}" — AI: ${fit.fitReason}`
        : `AI: ${fit.fitReason}`;
      const updated = await prisma.researchCandidate.updateMany({
        where: { id: candidate.id, tenantId: input.tenantId, runId: input.runId },
        data: {
          fitScore: score,
          fitReason: reason.slice(0, 300),
          fitSource: 'ai',
        },
      });
      scored += updated.count;
    }
  }

  return { scored, attempted: pool.length, unavailableReason };
}
