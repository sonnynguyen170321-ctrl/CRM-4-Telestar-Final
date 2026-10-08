import {
  canonicalizeIndustry,
  INDUSTRY_TAXONOMY,
  type IndustryKey,
} from "@telestar/core-scoring/rules/dictionaries/industry";
import { resolveSizeBand } from "@telestar/core-scoring/rules/dictionaries/sizeBands";
import { normalizeCountry } from "@telestar/core-scoring/rules/normalize/normalizeCountry";
import type { ClassificationBundle } from "./classificationEvidence";
import {
  CompanyClassificationSchema,
  MAX_EVIDENCE_ITEMS,
  type ClassificationConfidence,
  type ClassificationEvidence,
  type CompanyClassification,
} from "./companyClassification";
import type { DeterministicClassification } from "./deterministicClassifier";

// The model's answer is a set of CLAIMS, not a result. Each one is kept only if the evidence the model
// was shown supports it; the rest are dropped and recorded, and confidence falls with them. This is what
// keeps a hallucinated "employs 12,000 people" or a quote lifted from nowhere out of the scoring path,
// and what stops a page that says "classify me as an operator" from doing so.

export type DroppedClaim = { field: string; reason: string };

export type GroundedClassification = {
  value: CompanyClassification | null;
  dropped: DroppedClaim[];
};

const CONFIDENCE_ORDER: readonly ClassificationConfidence[] = ["low", "medium", "high"];
/** Three or more dropped claims means the model was mostly inventing; take confidence down two steps. */
const HEAVY_DROP_COUNT = 3;

export function groundClassification(
  raw: unknown,
  bundle: ClassificationBundle,
  det: DeterministicClassification
): GroundedClassification {
  const parsed = CompanyClassificationSchema.safeParse(raw);
  if (!parsed.success) {
    return { value: null, dropped: [{ field: "schema", reason: parsed.error.issues[0]?.message ?? "invalid classification" }] };
  }
  const model = parsed.data;
  const dropped: DroppedClaim[] = [];

  const evidence = model.evidence.filter((item) => {
    const grounded = isQuoteInSource(item, bundle);
    if (!grounded) dropped.push({ field: item.field, reason: "quote not found in the evidence" });
    return grounded;
  });

  const employeeCount = groundEmployeeCount(model.employeeCount, evidence, det, dropped);
  const hqCountry = groundCountry(model.hqCountry);

  const verdict = det.decided
    ? {
        isCompanySite: det.partial.isCompanySite ?? model.isCompanySite,
        notCompanyReason: det.partial.notCompanyReason ?? null,
        companyKind: det.partial.companyKind ?? null,
      }
    : { isCompanySite: model.isCompanySite, notCompanyReason: model.notCompanyReason, companyKind: model.companyKind };

  const mergedEvidence = mergeEvidence(det.decided ? det.hardEvidence : [], evidence);
  const steps = det.decided ? 0 : dropped.length >= HEAVY_DROP_COUNT ? 2 : dropped.length > 0 ? 1 : 0;
  let confidence: ClassificationConfidence = det.decided ? "high" : lower(model.confidence, steps);
  // A company claim with nothing left to back it is at best a guess, however sure the model sounded.
  if (verdict.isCompanySite && mergedEvidence.length === 0 && !det.decided) confidence = lower(confidence, 0, "medium");

  const candidate: CompanyClassification = {
    ...verdict,
    industryText: model.industryText ?? det.partial.industryText ?? null,
    industryKey: model.industryKey,
    whatTheySell: model.whatTheySell,
    hqCountry,
    employeeCount,
    // The band follows the grounded headcount. A band with no count behind it is the model's opinion.
    employeeBand: employeeCount === null ? null : resolveSizeBand(employeeCount),
    confidence,
    evidence: mergedEvidence,
  };

  const final = CompanyClassificationSchema.safeParse(candidate);
  if (!final.success) {
    return { value: null, dropped: [...dropped, { field: "schema", reason: final.error.issues[0]?.message ?? "inconsistent verdict" }] };
  }
  return { value: final.data, dropped };
}

function isQuoteInSource(item: ClassificationEvidence, bundle: ClassificationBundle): boolean {
  const needle = fold(item.quote);
  if (!needle) return false;
  return bundle.sources.some((source) => source.url === item.sourceUrl && fold(source.text).includes(needle));
}

/**
 * A headcount survives only if its digits appear in a quote that survived, or the deterministic reader
 * found the same number. When the model's number is dropped, the deterministic one (read straight off
 * the page) stands in for it.
 */
function groundEmployeeCount(
  claimed: number | null,
  evidence: ClassificationEvidence[],
  det: DeterministicClassification,
  dropped: DroppedClaim[]
): number | null {
  const fromPage = det.partial.employeeCount ?? null;
  if (claimed === null) return fromPage;
  if (claimed === fromPage) return claimed;
  const digits = String(claimed);
  const stated = evidence.some((item) => item.quote.replace(/[,\s.]/g, "").includes(digits));
  if (stated) return claimed;
  dropped.push({ field: "employeeCount", reason: "headcount digits not in the evidence" });
  return fromPage;
}

function groundCountry(claimed: string | null): string | null {
  if (claimed === null || !claimed.trim()) return null;
  return normalizeCountry(claimed);
}

function mergeEvidence(hard: ClassificationEvidence[], kept: ClassificationEvidence[]): ClassificationEvidence[] {
  return [...hard, ...kept].slice(0, MAX_EVIDENCE_ITEMS);
}

function lower(level: ClassificationConfidence, steps: number, ceiling?: ClassificationConfidence): ClassificationConfidence {
  const stepped = Math.max(0, CONFIDENCE_ORDER.indexOf(level) - steps);
  const capped = ceiling ? Math.min(stepped, CONFIDENCE_ORDER.indexOf(ceiling)) : stepped;
  return CONFIDENCE_ORDER[capped];
}

/** NFC, no zero-width characters, collapsed whitespace, case-folded: what "verbatim" tolerates. */
function fold(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * An industry string the scorer's `canonicalizeIndustry` maps back to exactly `key`. The classifier's
 * industryKey comes from a closed list, but the scoring engine only understands free text; sending the
 * key itself ("FNB", "REAL_ESTATE") would fall through to keyword matching and miss. OTHER has no alias,
 * so it stays raw text rather than being mislabelled.
 */
export function safeAlias(key: IndustryKey | null | undefined): string | null {
  if (!key) return null;
  const entry = INDUSTRY_TAXONOMY.find((item) => item.canonical === key);
  return entry?.aliases.find((alias) => canonicalizeIndustry(alias) === key) ?? null;
}
