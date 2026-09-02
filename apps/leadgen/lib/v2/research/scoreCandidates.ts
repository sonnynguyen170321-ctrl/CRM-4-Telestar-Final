import type { ParsedCandidate } from "./parseDiscoveryResults";

// Deterministic ICP-fit heuristic. Always runs (zero AI), so candidates are rankable even when
// the AI-fit layer is off. Score = how many distinct ICP/query hint tokens actually surface in
// the harvested evidence, plus small evidence-quality bonuses. Identity evidence (name / company /
// title / domain) counts full; the SERP snippet is weaker corroboration and counts half, so
// keyword-stuffed page text cannot outrank a real, on-target person. The AI-fit layer (opt-in) may
// overwrite score/reason later with fitSource="ai".

export type HeuristicFit = { score: number; reason: string };

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

export function scoreCandidateHeuristic(parsed: ParsedCandidate, hints: string[]): HeuristicFit {
  const identity = [
    tokenize(parsed.name),
    tokenize(parsed.companyName),
    tokenize(parsed.title),
    tokenize(parsed.location),
    tokenize(parsed.domain),
  ].join(" | ");
  const snippetText = tokenize(parsed.source.snippet);

  const signalHints = Array.from(
    new Set(
      hints
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length >= 2 && !STOP_MODIFIERS.has(h))
    )
  );
  const identityMatched = signalHints.filter((h) => hintMatcher(h).test(identity));
  const snippetOnly = signalHints.filter(
    (h) => !identityMatched.includes(h) && hintMatcher(h).test(snippetText)
  );
  const matched = [...identityMatched, ...snippetOnly];

  let score = 40;
  score += Math.min(identityMatched.length * 12 + snippetOnly.length * 6, 42);
  if (parsed.domain || parsed.linkedinUrl) score += 8;
  if (parsed.source.snippet && parsed.source.snippet.trim().length > 0) score += 6;
  if (parsed.kind === "CONTACT" && parsed.title) score += 4;
  score = Math.max(0, Math.min(100, score));

  const reason = matched.length
    ? `Matched ${matched.length} ICP signal${matched.length === 1 ? "" : "s"}: ${matched.slice(0, 4).join(", ")}`
    : signalHints.length
      ? "No ICP terms found in the harvested evidence — verify before promoting"
      : "Discovered by query; no ICP hint tokens to match against";

  return { score, reason };
}
