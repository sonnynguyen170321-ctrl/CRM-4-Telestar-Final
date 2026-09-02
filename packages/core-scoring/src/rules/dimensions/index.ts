import type {
  DimensionKey,
  DimensionResult,
  NormalizedScoringEvidence,
} from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";
import { geoScore } from "./geoScore";
import { industryScore } from "./industryScore";
import { companyTypeScore } from "./companyTypeScore";
import { sizeScore } from "./sizeScore";
import { personaScore } from "./personaScore";
import { signalScore } from "./signalScore";

// SC2: pipeline step 3 — run every per-dimension scorer and assemble the result.
// Each scorer is pure and returns hits + missingEvidence so the why-drawer and
// reason codes are fully explainable (plan §4c.3). Pure.

export { geoScore, industryScore, companyTypeScore, sizeScore, personaScore, signalScore };

export type SubScores = Record<DimensionKey, number>;

export type DimensionScoringResult = {
  subScores: SubScores;
  results: Record<DimensionKey, DimensionResult>;
  hits: DimensionResult["hits"];
  missingEvidence: string[];
};

export function scoreDimensions(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): DimensionScoringResult {
  const results: Record<DimensionKey, DimensionResult> = {
    geo: geoScore(evidence, rules),
    industry: industryScore(evidence, rules),
    companyType: companyTypeScore(evidence, rules),
    size: sizeScore(evidence, rules),
    persona: personaScore(evidence, rules),
    signals: signalScore(evidence, rules),
  };

  const subScores = {
    geo: results.geo.score,
    industry: results.industry.score,
    companyType: results.companyType.score,
    size: results.size.score,
    persona: results.persona.score,
    signals: results.signals.score,
  } satisfies SubScores;

  const hits = (Object.keys(results) as DimensionKey[]).flatMap(
    (key) => results[key].hits
  );
  const missingEvidence = [
    ...new Set(
      (Object.keys(results) as DimensionKey[]).flatMap(
        (key) => results[key].missingEvidence
      )
    ),
  ];

  return { subScores, results, hits, missingEvidence };
}
