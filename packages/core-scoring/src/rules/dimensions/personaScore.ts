import type { DimensionHit, DimensionResult, NormalizedScoringEvidence } from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";
import { meetsSeniorityFloor } from "../dictionaries/seniority";
import type { Department, SeniorityTier } from "../dictionaries/seniority";
import { foldText } from "../normalize/normalizeCountry";

// SC2: persona dimension (contact-level). Priority order:
//   denylist / seniority-exclusion (0) > allowlist (100) > tier weight >
//   keyword (70) > neutral (60) > off-target (25), then seniority-floor and
//   department-allowlist penalties. Pure.

// Abbreviation <-> expansion pairs. Uploaded contact lists and authored ICPs mix both forms ("CEO" vs
// "Chief Executive Officer"). Without this the two never meet: a 2-4 char entry like "ceo" requires an
// exact token, so it silently missed every spelled-out C-level title, and conversely a spelled-out
// entry could not match an abbreviated title. Both directions cost real persona points.
const TITLE_SYNONYMS: ReadonlyArray<readonly [string, string]> = [
  ["ceo", "chief executive officer"],
  ["cto", "chief technology officer"],
  ["cfo", "chief financial officer"],
  ["coo", "chief operating officer"],
  ["cio", "chief information officer"],
  ["cmo", "chief marketing officer"],
  ["cro", "chief revenue officer"],
  ["cpo", "chief product officer"],
  ["cdo", "chief data officer"],
  ["cgo", "chief growth officer"],
  ["cbo", "chief business officer"],
  ["ciso", "chief information security officer"],
  ["chro", "chief human resources officer"],
  ["md", "managing director"],
  ["gm", "general manager"],
  ["vp", "vice president"],
  ["svp", "senior vice president"],
  ["evp", "executive vice president"],
  ["hr", "human resources"],
  ["it", "information technology"],
];

/**
 * Folded title plus every synonym form it implies, so entries written either way match. Additive only:
 * the original text is preserved, so an expansion can never remove an existing match.
 */
export function expandTitleSynonyms(foldedTitle: string): string {
  const tokens = new Set(foldedTitle.split(/[^a-z0-9]+/).filter(Boolean));
  const extras: string[] = [];
  for (const [abbr, phrase] of TITLE_SYNONYMS) {
    if (tokens.has(abbr) && !foldedTitle.includes(phrase)) extras.push(phrase);
    else if (foldedTitle.includes(phrase) && !tokens.has(abbr)) extras.push(abbr);
  }
  return extras.length > 0 ? `${foldedTitle} ${extras.join(" ")}` : foldedTitle;
}

/** Joining words that carry no meaning in a title: "VP of Sales" and "VP, Sales" are the same role. */
const TITLE_STOPWORDS = new Set(["of", "the", "and", "for", "at", "in", "to"]);

/**
 * A title as a set of meaningful words, every abbreviation spelled out ("vp" -> "vice", "president").
 * Word order and punctuation drop away, so "Director of Sales" and "Sales Director", or
 * "VP, Sales" and "Vice President of Sales", become the same set.
 */
export function titleWordSet(text: string): Set<string> {
  const words = foldText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !TITLE_STOPWORDS.has(word));
  const out = new Set<string>();
  for (const word of words) {
    const expansion = TITLE_SYNONYMS.find(([abbr]) => abbr === word)?.[1];
    for (const part of (expansion ?? word).split(" ")) out.add(part);
  }
  return out;
}

/**
 * Every meaningful word of a multi-word entry appears in the title, in any order (production,
 * 2026-10-06: "Vice President of Sales" and "Sales Director" scored as off-target against "VP Sales"
 * and "Director of Sales"). A one-word entry never matches this way: "GM" spelled out is
 * {general, manager}, which "General Counsel / Sales Manager" contains without being a GM.
 */
export function titleContainsEntry(title: string, entry: string): boolean {
  const meaningful = foldText(entry)
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !TITLE_STOPWORDS.has(word));
  if (meaningful.length < 2) return false;
  const titleWords = titleWordSet(title);
  return [...titleWordSet(entry)].every((word) => titleWords.has(word));
}

/**
 * `loose` adds word-set matching on top of the exact forms. The denylist stays exact: a denylist hit
 * rules a lead out, and word sets ignore adjacency — "Marketing Manager" would hit
 * "Senior Manager, Sales and Marketing".
 */
function titleMatches(foldedTitle: string, entries: readonly string[], loose = true): boolean {
  const titleTokens = new Set(foldedTitle.split(/[^a-z0-9]+/).filter(Boolean));

  return entries.some((entry) => {
    const folded = foldText(entry);
    if (!folded) {
      return false;
    }

    if (/^[a-z0-9]{2,4}$/.test(folded)) {
      if (titleTokens.has(folded)) return true;
    } else if (foldedTitle.includes(folded)) {
      return true;
    }

    return loose && titleContainsEntry(foldedTitle, folded);
  });
}

export function personaScore(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): DimensionResult {
  const { persona } = rules;
  const hits: DimensionHit[] = [];
  const missingEvidence: string[] = [];
  const contact = evidence.contact;

  if (!contact || !contact.titlePresent || !contact.rawTitle) {
    if (persona.requirePersonaForFinalQualification) {
      missingEvidence.push("target_persona_missing_required");
    }
    return { dimension: "persona", score: 0, hits, missingEvidence };
  }

  const foldedTitle = expandTitleSynonyms(foldText(contact.rawTitle));
  const tier: SeniorityTier = contact.seniorityTier;
  const department: Department = contact.department;

  // 1. Hard negatives (decisive)
  if (titleMatches(foldedTitle, persona.titleDenylist, false)) {
    hits.push({ id: "persona_denylisted", label: "Title on persona denylist", reasonCode: "persona_title_denylisted" });
    return { dimension: "persona", score: 0, hits, missingEvidence };
  }
  if (persona.seniorityExclusions.includes(tier)) {
    hits.push({ id: "persona_seniority_excluded", label: `Excluded seniority (${tier})`, reasonCode: "persona_seniority_excluded" });
    return { dimension: "persona", score: 0, hits, missingEvidence };
  }

  // 2. Positive match -> base score
  let score: number;
  const hasPositiveConstraint =
    persona.titleAllowlist.length > 0 ||
    persona.titleTiers.length > 0 ||
    persona.titleKeywords.length > 0;

  if (titleMatches(foldedTitle, persona.titleAllowlist)) {
    score = 100;
    hits.push({ id: "persona_allowlist_match", label: "Title on persona allowlist", reasonCode: "persona_title_allowlist" });
  } else {
    const tierMatch = persona.titleTiers.find(
      (titleTier) =>
        titleMatches(foldedTitle, titleTier.titles) ||
        titleMatches(foldedTitle, titleTier.keywords)
    );

    if (tierMatch) {
      score = tierMatch.weight;
      hits.push({ id: `persona_tier_${tierMatch.tier}`, label: `Persona tier ${tierMatch.tier} match`, reasonCode: "persona_title_tier" });
    } else if (titleMatches(foldedTitle, persona.titleKeywords)) {
      score = 70;
      hits.push({ id: "persona_keyword_match", label: "Persona keyword match", reasonCode: "persona_title_keyword" });
    } else if (!hasPositiveConstraint) {
      score = 60; // title present, no specific persona constraint authored
    } else {
      score = 25;
      hits.push({ id: "persona_off_target", label: "Title off target persona", reasonCode: "persona_title_off_target" });
    }
  }

  // 3. Seniority floor (with department override, e.g. HR/Admin accept IC)
  const overrideFloor = persona.departmentSeniorityOverrides[department] as
    | SeniorityTier
    | undefined;
  const authoredFloor = persona.seniorityFloor as SeniorityTier | undefined;
  const effectiveFloor: SeniorityTier | undefined =
    overrideFloor ?? authoredFloor;
  if (effectiveFloor && !meetsSeniorityFloor(tier, effectiveFloor)) {
    score = Math.min(score, 40);
    hits.push({ id: "persona_below_seniority_floor", label: `Below seniority floor (${tier} < ${effectiveFloor})`, reasonCode: "persona_below_seniority_floor" });
  }

  // 4. Department allowlist
  if (
    persona.departmentAllowlist.length > 0 &&
    department !== "UNKNOWN" &&
    !persona.departmentAllowlist.includes(department)
  ) {
    score = Math.min(score, 40);
    hits.push({ id: "persona_department_off", label: `Off-target department (${department})`, reasonCode: "persona_department_off_target" });
  }

  return { dimension: "persona", score, hits, missingEvidence };
}
