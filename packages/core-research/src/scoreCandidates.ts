import type { ParsedCandidate } from "./parseDiscoveryResults";

// Deterministic ICP-fit heuristic. Always runs (zero AI), so candidates are rankable even when
// the AI-fit layer is off. Score = how many distinct ICP/query hint tokens actually surface in
// the harvested evidence, plus small evidence-quality bonuses. Identity evidence (name / company /
// title / domain) counts full; the SERP snippet is weaker corroboration and counts half, so
// keyword-stuffed page text cannot outrank a real, on-target person. The AI-fit layer (opt-in) may
// overwrite score/reason later with fitSource="ai".
//
// Contacts from a run that searched for persona titles are judged differently — see
// `scoreContactAgainstPersonas`. For a person, the job title is the fit: a search for "CEO" that
// surfaces a Lead Developer at a UK SaaS company has found the right company and the wrong person,
// and the keyword count used to score that 76 with the reason "Matched 3 ICP signals: lead, saas,
// united kingdom".

export type HeuristicFit = { score: number; reason: string };

export type HeuristicOptions = {
  /**
   * Every persona title the run searched for (`personaTitlesOf`). When present, a CONTACT is scored
   * on whether its job title matches one of them, and the titles stop counting as generic keywords.
   */
  personaTitles?: string[];
};

const STOP_MODIFIERS = new Set([
  "companies", "vendors", "providers", "platforms", "software", "services", "solutions",
  "startups", "directory", "list", "linkedin", "people", "employees", "team", "leadership",
  "site:linkedin.com/in",
]);

function tokenize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().normalize("NFC");
}

// Word-boundary matcher (Unicode edges, NFC) — mirrors the classification taxonomy. Plain substring
// matching let a 2-char hint like "it" or "hr" fire inside unrelated words and inflate the score.
const matcherCache = new Map<string, RegExp>();
function hintMatcher(hint: string): RegExp {
  let re = matcherCache.get(hint);
  if (!re) {
    const escaped = hint.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    matcherCache.set(hint, re);
  }
  return re;
}

function signalHintsOf(hints: string[], exclude: Set<string> = new Set()): string[] {
  return Array.from(
    new Set(
      hints
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length >= 2 && !STOP_MODIFIERS.has(h) && !exclude.has(h))
    )
  );
}

function evidenceBonus(parsed: ParsedCandidate): number {
  let bonus = 0;
  if (parsed.domain || parsed.linkedinUrl) bonus += 8;
  if (parsed.source.snippet && parsed.source.snippet.trim().length > 0) bonus += 6;
  return bonus;
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreCandidateHeuristic(
  parsed: ParsedCandidate,
  hints: string[],
  options: HeuristicOptions = {}
): HeuristicFit {
  const personas = Array.from(
    new Map((options.personaTitles ?? []).map((t) => [t.trim().toLowerCase(), t.trim()])).values()
  ).filter((t) => t.length >= 2);
  if (parsed.kind === "CONTACT" && personas.length > 0) {
    return scoreContactAgainstPersonas(parsed, hints, personas);
  }

  const identity = [
    tokenize(parsed.name),
    tokenize(parsed.companyName),
    tokenize(parsed.title),
    tokenize(parsed.location),
    tokenize(parsed.domain),
  ].join(" | ");
  const snippetText = tokenize(parsed.source.snippet);

  const signalHints = signalHintsOf(hints);
  const identityMatched = signalHints.filter((h) => hintMatcher(h).test(identity));
  const snippetOnly = signalHints.filter(
    (h) => !identityMatched.includes(h) && hintMatcher(h).test(snippetText)
  );
  const matched = [...identityMatched, ...snippetOnly];

  let score = 40;
  score += Math.min(identityMatched.length * 12 + snippetOnly.length * 6, 42);
  score += evidenceBonus(parsed);
  if (parsed.kind === "CONTACT" && parsed.title) score += 4;

  const reason = matched.length
    ? `Matched ${matched.length} ICP signal${matched.length === 1 ? "" : "s"}: ${matched.slice(0, 4).join(", ")}`
    : signalHints.length
      ? "No ICP terms found in the harvested evidence — verify before promoting"
      : "Discovered by query; no ICP hint tokens to match against";

  return { score: clamp(score), reason };
}

/** Highest score a contact whose title misses every persona can reach. Below any review threshold. */
export const OFF_PERSONA_SCORE_CAP = 35;

/**
 * A contact, judged first on its job title.
 *
 * - **Title matches a persona** — the person is who the run was looking for. Starts at 60, and the
 *   company / geography terms (matched against company, location and domain, not the name) and the
 *   evidence quality move it up from there.
 * - **Title present, matches none** — the wrong person, however well the company fits. Capped at
 *   `OFF_PERSONA_SCORE_CAP`, and the reason names the title so the SDR sees why at a glance.
 * - **No title harvested** — unknown, not wrong. Scored in between and flagged for a check; higher
 *   when the profile text names a persona, which is how most neural-search contacts arrive.
 *
 * Persona titles are matched against the title field only, and removed from the generic hint list,
 * so "lead" in a company called "Lead Capital" or "Head" in a page snippet counts for nothing.
 */
function scoreContactAgainstPersonas(
  parsed: ParsedCandidate,
  hints: string[],
  personas: string[]
): HeuristicFit {
  const title = tokenize(parsed.title).trim();
  const personaSet = new Set(personas.map((p) => p.toLowerCase()));
  const context = [tokenize(parsed.companyName), tokenize(parsed.location), tokenize(parsed.domain)].join(" | ");
  const snippetText = tokenize(parsed.source.snippet);

  const contextHints = signalHintsOf(hints, personaSet);
  const contextMatched = contextHints.filter((h) => hintMatcher(h).test(context));
  const snippetOnly = contextHints.filter(
    (h) => !contextMatched.includes(h) && hintMatcher(h).test(snippetText)
  );
  const contextPoints = Math.min(contextMatched.length * 8 + snippetOnly.length * 4, 24);
  const alsoMatched = [...contextMatched, ...snippetOnly];
  const also = alsoMatched.length ? `; also matched ${alsoMatched.slice(0, 3).join(", ")}` : "";

  if (!title) {
    // Exa names a profile page by the person alone, so most neural-search contacts arrive with no
    // title field, and the parser rightly refuses to invent one. Their highlight is steered to the
    // current job title, though, so a persona named in it is real evidence — weaker than a title
    // field, and labelled as such: "mentions", not "matches".
    const mentioned = personas.find((p) => hintMatcher(p.toLowerCase()).test(snippetText));
    if (mentioned) {
      return {
        score: clamp(Math.min(48 + contextPoints / 2 + evidenceBonus(parsed) / 2, 70)),
        reason: `Profile text mentions "${mentioned}" — title not confirmed${also}`,
      };
    }
    return {
      score: clamp(Math.min(36 + contextPoints / 2 + evidenceBonus(parsed) / 2, 50)),
      reason: `No job title found — check the person is a ${personas.slice(0, 3).join(" / ")} before promoting${also}`,
    };
  }

  const personaHit = personas.find((p) => hintMatcher(p.toLowerCase()).test(title));
  if (!personaHit) {
    return {
      score: clamp(Math.min(20 + contextPoints / 2, OFF_PERSONA_SCORE_CAP)),
      reason: `Title "${parsed.title}" is outside the searched personas (${personas.slice(0, 4).join(", ")})`,
    };
  }

  return {
    score: clamp(60 + contextPoints + evidenceBonus(parsed)),
    reason: `Title matches persona "${personaHit}"${also}`,
  };
}
