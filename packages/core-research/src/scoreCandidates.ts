import { expandTitleSynonyms, titleContainsEntry } from "@telestar/core-scoring/rules/dimensions/personaScore";
import { foldText } from "@telestar/core-scoring/rules/normalize/normalizeCountry";

import type { ParsedCandidate } from "./parseDiscoveryResults";
import { extractPersonHeadline, extractPersonLocation } from "./personProfile";
import { resolveCountry } from "./rulesFromParams";

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

export type HeuristicFit = {
  score: number;
  reason: string;
  /** Contacts of a run with target countries: where the person stands against them. */
  geo?: "not_applicable" | "match" | "outside" | "unknown";
  /** Set when the heuristic alone rules the person out. */
  rejection?: "person_outside_target";
};

export type HeuristicOptions = {
  /**
   * Every persona title the run searched for (`personaTitlesOf`). When present, a CONTACT is scored
   * on whether its job title matches one of them, and the titles stop counting as generic keywords.
   */
  personaTitles?: string[];
  /** Canonical target countries of the run. Empty = no geography gate. */
  targetCountries?: string[];
  /** `BuilderRules.geoGate`: false when any geography could not be placed, so a partial list never rejects. */
  geoGate?: boolean;
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
    return scoreContactAgainstPersonas(parsed, hints, personas, options);
  }

  const identity = [
    tokenize(parsed.name),
    tokenize(parsed.companyName),
    tokenize(parsed.title),
    tokenize(parsed.location),
    tokenize(parsed.domain),
  ].join(" | ");
  const snippetText = tokenize(parsed.source.snippet);

  const isContact = parsed.kind === "CONTACT";
  const signalHints = signalHintsOf(hints).filter((h) => !isContact || !isCountryHint(h));
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

  const fit: HeuristicFit = { score: clamp(score), reason };
  return isContact ? applyGeo(fit, currentProfileOf(parsed), options) : fit;
}

/** Highest score a contact whose title misses every persona can reach. Below any review threshold. */
export const OFF_PERSONA_SCORE_CAP = 35;
/** A title that is only stated in the profile headline, never confirmed: never reaches the review band. */
export const UNCONFIRMED_TITLE_SCORE_CAP = 45;
/** A person whose country the profile does not state, when the run targets countries: worth a look at most. */
export const UNKNOWN_COUNTRY_SCORE_CAP = 55;
/** A person whose stated country is outside the run's target countries. */
export const OUTSIDE_TARGET_SCORE_CAP = 15;

/** The part of a profile the score is allowed to read: what is true of the person NOW. */
export type CurrentProfile = {
  title: string | null;
  titleConfirmed: boolean;
  employer: string | null;
  location: string | null;
  country: string | null;
};

export function currentProfileOf(parsed: ParsedCandidate): CurrentProfile {
  const head = extractPersonHeadline(parsed.source.snippet, parsed.name);
  const place = parsed.location || parsed.country ? null : extractPersonLocation(parsed.source.snippet);
  const location = parsed.location ?? place?.location ?? null;
  const country = parsed.country ?? (parsed.location ? resolveCountry(parsed.location) : null) ?? place?.country ?? null;
  const confirmed = Boolean(parsed.title?.trim());
  return {
    title: confirmed ? parsed.title!.trim() : (head?.title ?? null),
    titleConfirmed: confirmed,
    employer: parsed.companyName ?? head?.employer ?? null,
    location,
    country,
  };
}

// A title that names the persona but is the person who SERVES it, or used to be it.
const PERSONA_SATELLITE_TITLE =
  /(?<![\p{L}\p{N}])(assistant|assistance|advisor|adviser|secretary|chief of staff|office of|intern|former|ex|retired|aspiring|future)(?![\p{L}\p{N}])/iu;

/** Exact phrase, or the same words in any order with abbreviations spelled out ("VP Sales" = "Vice President of Sales"). */
export function titleMatchesPersona(title: string, persona: string): boolean {
  const t = tokenize(title);
  const p = tokenize(persona).trim();
  if (!t.trim() || !p) return false;
  if (PERSONA_SATELLITE_TITLE.test(t) && !PERSONA_SATELLITE_TITLE.test(p)) return false;
  if (hintMatcher(p).test(t) || hintMatcher(p).test(expandTitleSynonyms(foldText(title)))) return true;
  return titleContainsEntry(title, persona);
}

export type GeoVerdict = "not_applicable" | "match" | "outside" | "unknown";

/** Where a person stands against the run's target countries (canonical names). */
export function geoVerdictFor(country: string | null, targetCountries: readonly string[] | undefined): GeoVerdict {
  const targets = (targetCountries ?? []).map((c) => foldText(c));
  if (targets.length === 0) return "not_applicable";
  if (!country) return "unknown";
  return targets.includes(foldText(country)) ? "match" : "outside";
}

function applyGeo(fit: HeuristicFit, profile: CurrentProfile, options: HeuristicOptions): HeuristicFit {
  if (options.geoGate === false) return fit;
  const verdict = geoVerdictFor(profile.country, options.targetCountries);
  if (verdict === "not_applicable") return fit;
  if (verdict === "match") {
    return { ...fit, score: clamp(fit.score + 6), geo: verdict, reason: `${fit.reason}; located in ${profile.country}` };
  }
  if (verdict === "outside") {
    return {
      score: Math.min(fit.score, OUTSIDE_TARGET_SCORE_CAP),
      reason: `Located in ${profile.country} (${profile.location}), outside the target countries`,
      geo: verdict,
      rejection: "person_outside_target",
    };
  }
  return {
    ...fit,
    score: Math.min(fit.score, UNKNOWN_COUNTRY_SCORE_CAP),
    geo: verdict,
    reason: `${fit.reason}; location not stated -- confirm the person is in the target countries`,
  };
}

/** A run's countries are a gate, not ranking keywords. */
// Never a two-letter hint: "it" and "hr" are industries and departments before they are Italy and Croatia.
const isCountryHint = (hint: string): boolean => hint.trim().length >= 3 && resolveCountry(hint) !== null;

/**
 * A contact, judged first on its CURRENT job title, then on where they are.
 *
 * - Everything is read from the current profile (`currentProfileOf`): the title field or the profile's
 *   headline, the employer, the location line. A past role, a deployment or a skills list further down the
 *   highlight never counts -- that is how a Texas maintenance director "matched" Afghanistan.
 * - Title matches a persona (exact phrase, or the same words / abbreviations) from a title field: starts at
 *   60. From the headline only it is "title not confirmed", capped at `UNCONFIRMED_TITLE_SCORE_CAP`.
 * - Title present, matches none: capped at `OFF_PERSONA_SCORE_CAP`.
 * - No title anywhere: unknown, scored low and flagged.
 * - Geography is a gate (`applyGeo`) when the run targets countries.
 */
function scoreContactAgainstPersonas(
  parsed: ParsedCandidate,
  hints: string[],
  personas: string[],
  options: HeuristicOptions
): HeuristicFit {
  const profile = currentProfileOf(parsed);
  const personaSet = new Set(personas.map((p) => p.toLowerCase()));
  const context = [tokenize(profile.employer), tokenize(profile.location), tokenize(parsed.domain)].join(" | ");

  const contextHints = signalHintsOf(hints, personaSet).filter((h) => !isCountryHint(h));
  const contextMatched = contextHints.filter((h) => hintMatcher(h).test(context));
  const contextPoints = Math.min(contextMatched.length * 8, 24);
  const also = contextMatched.length ? `; also matched ${contextMatched.slice(0, 3).join(", ")}` : "";
  const evidence = evidenceBonus(parsed);

  let fit: HeuristicFit;
  if (!profile.title) {
    fit = {
      score: clamp(Math.min(30 + contextPoints / 2 + evidence / 2, 40)),
      reason: `No current job title found -- check the person is a ${personas.slice(0, 3).join(" / ")} before promoting${also}`,
    };
  } else {
    const personaHit = personas.find((p) => titleMatchesPersona(profile.title!, p));
    if (!personaHit) {
      fit = {
        score: clamp(Math.min(20 + contextPoints / 2, OFF_PERSONA_SCORE_CAP)),
        reason: `Title "${profile.title}" is outside the searched personas (${personas.slice(0, 4).join(", ")})`,
      };
    } else if (!profile.titleConfirmed) {
      fit = {
        score: clamp(Math.min(34 + contextPoints / 2 + evidence / 2, UNCONFIRMED_TITLE_SCORE_CAP)),
        reason: `Profile headline says "${profile.title}", matching "${personaHit}" -- title not confirmed${also}`,
      };
    } else {
      fit = { score: clamp(60 + contextPoints + evidence), reason: `Title matches persona "${personaHit}"${also}` };
    }
  }
  return applyGeo(fit, profile, options);
}
