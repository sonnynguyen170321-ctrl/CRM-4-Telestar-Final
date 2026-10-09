import type { DimensionHit, DimensionResult, NormalizedScoringEvidence } from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";
import { industryKeysForTerm, industryWithParents, type IndustryKey } from "../dictionaries/industry";
import { containsTerm } from "../dictionaries/termMatch";
import { CATEGORY_PREFERRED_SECTORS, classifyServedVerticals } from "../dictionaries/servedVertical";
import { foldText } from "../normalize/normalizeCountry";

// SC2: industry dimension. mode all|allowlist|denylist + keyword bonus + sub-industry.
// Excluded-industry match scores 0 but is NOT terminal here. Pure.

function companyIndustryTokens(evidence: NormalizedScoringEvidence): Set<string> {
  const tokens = new Set<string>();

  if (evidence.company.industryCanonical) {
    for (const key of industryWithParents(evidence.company.industryCanonical)) {
      tokens.add(foldText(key));
    }
  }
  if (evidence.company.industryRaw) {
    tokens.add(foldText(evidence.company.industryRaw));
  }
  for (const tag of evidence.company.industryTags) {
    tokens.add(foldText(tag));
  }

  // W5 (#6): enrich with served-vertical classification (the "SaaS-for-finance / manufacturing-for-wool"
  // depth) so allow/deny/keyword lists that name a sub-vertical ("wool", "fintech", "rubber") still match
  // when the raw industry is only the broad category and the text uses a synonym ("merino worsted" → WOOL).
  // Additive tokens only — forward-only, deterministic, existing rules that don't name a vertical are
  // unaffected. No rescore of existing immutable assessments.
  const verticalText = [evidence.company.industryRaw, ...evidence.company.industryTags, evidence.company.evidenceText]
    .filter(Boolean)
    .join(" ");
  // Same tie-break the drawer applies: a company already classified as a food producer must resolve
  // its vertical inside AGRICULTURE, not pick up an INDUSTRIAL token because its site says "factory".
  // Without this the extra token can match an ICP's excludedIndustries and zero the dimension.
  const preferredSectors = evidence.company.industryCategory
    ? CATEGORY_PREFERRED_SECTORS[evidence.company.industryCategory] ?? []
    : [];
  for (const v of classifyServedVerticals(verticalText, 4, preferredSectors)) {
    tokens.add(foldText(v.key));
    tokens.add(foldText(v.label));
    if (v.parentLabel) tokens.add(foldText(v.parentLabel));
  }

  return tokens;
}

/**
 * An ICP industry entry matches when it is one of the company's tokens, names one of `keys` by its
 * canonical form ("Bank" -> BANKING, "Hospitals" -> HEALTHCARE) or shorthand ("Tech" -> the software
 * and IT keys, see INDUSTRY_SHORTHANDS), or appears in the evidence text as a whole word. Substring
 * matching (v1) let "ISP" fire inside "display" and an excluded "bet" inside "alphabet".
 */
function listMatches(list: readonly string[], tokens: Set<string>, text: string, keys: ReadonlySet<IndustryKey>): boolean {
  return list.some((entry) => {
    const folded = foldText(entry);
    if (folded.length === 0) return false;
    if (tokens.has(folded)) return true;
    if (industryKeysForTerm(entry).some((key) => keys.has(key))) return true;
    return containsTerm(text, entry, { plural: true });
  });
}

/**
 * The score for "the industry is known and nothing in the allowlist (or keywords) matched". Exported so the
 * research verifier reads the same number instead of copying it (lib/research/verifyScoring.ts).
 */
export const INDUSTRY_ALLOWLIST_MISS_SCORE = 20;

export function industryScore(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): DimensionResult {
  const { industry } = rules;
  const hits: DimensionHit[] = [];
  const missingEvidence: string[] = [];
  const tokens = companyIndustryTokens(evidence);
  const text = evidence.company.evidenceText;

  // Denylist always applies regardless of mode.
  // A target names the company's key or any parent ("Software" admits a SaaS company); an exclusion
  // names the company's own key only — excluding "IT services" must not exclude every cybersecurity
  // vendor because CYBERSECURITY sits under IT_SERVICES.
  const ownKey = evidence.company.industryCanonical;
  const exclusionKeys = new Set<IndustryKey>(ownKey ? [ownKey] : []);
  const targetKeys = new Set<IndustryKey>(ownKey ? industryWithParents(ownKey) : []);

  if (listMatches(industry.excludedIndustries, tokens, text, exclusionKeys)) {
    hits.push({
      id: "industry_excluded",
      label: "Industry on exclusion list",
      reasonCode: "target_industry_mismatch",
    });
    return { dimension: "industry", score: 0, hits, missingEvidence };
  }

  // Whole words, as in listMatches: a keyword "AI" must not fire inside "email" or "maintain".
  const keywordHit = industry.industryKeywords.some((keyword) =>
    containsTerm(text, keyword, { plural: true })
  );

  if (industry.mode === "all") {
    if (keywordHit) {
      hits.push({ id: "industry_keyword_match", label: "Industry keyword match", reasonCode: "target_industry_match" });
    }
    return { dimension: "industry", score: keywordHit ? 90 : 80, hits, missingEvidence };
  }

  if (industry.mode === "denylist") {
    return { dimension: "industry", score: 90, hits, missingEvidence };
  }

  // allowlist
  const industryKnown =
    evidence.company.industryCanonical !== null ||
    evidence.company.industryRaw !== null ||
    evidence.company.industryTags.length > 0;

  if (!industryKnown) {
    missingEvidence.push("industry_unknown");
    return { dimension: "industry", score: 50, hits, missingEvidence };
  }

  const allowMatch =
    listMatches(industry.targetIndustries, tokens, text, targetKeys) ||
    listMatches(industry.subIndustries, tokens, text, targetKeys);

  if (allowMatch) {
    hits.push({ id: "industry_allowlist_match", label: "In target industry", reasonCode: "target_industry_match" });
    return { dimension: "industry", score: keywordHit ? 100 : 95, hits, missingEvidence };
  }

  if (keywordHit) {
    hits.push({ id: "industry_keyword_match", label: "Industry keyword match", reasonCode: "target_industry_match" });
    return { dimension: "industry", score: 60, hits, missingEvidence };
  }

  return { dimension: "industry", score: INDUSTRY_ALLOWLIST_MISS_SCORE, hits, missingEvidence };
}
