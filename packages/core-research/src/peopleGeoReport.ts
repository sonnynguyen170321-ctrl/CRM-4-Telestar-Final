import { countryVariants, foldText } from "@telestar/core-scoring/rules/normalize/normalizeCountry";

import type { ParsedCandidate } from "./parseDiscoveryResults";
import { currentProfileOf, geoVerdictFor, scoreCandidateHeuristic, type GeoVerdict } from "./scoreCandidates";

// Proof, not argument (owner, 2026-10-13): for a contact run, how many of the people it returned are really in
// the countries it was asked for, judged the old way and the new way. Pure: rows in, numbers out.
//
// BEFORE is what the stored scores say, plus what the old scorer believed about geography: it counted the
// run's country as a keyword found ANYWHERE in the profile text (`mentionedAnywhere`).
// AFTER re-scores the stored snippets with the current scorer, which reads the profile head only and gates.
// "Truth" for both is the profile head, read by rules: the one place a person's current country is stated.

export type PeopleEvalRow = {
  name: string;
  title: string | null;
  companyName: string | null;
  location: string | null;
  country: string | null;
  snippet: string | null;
  /** The score stored when the candidate was discovered (what a rep saw). */
  storedScore: number | null;
};

export type GeoShares = { total: number; match: number; outside: number; unknown: number };

export type PeopleEvalReport = {
  targetCountries: string[];
  total: number;
  /** The head-of-profile truth for everyone returned. */
  actual: GeoShares;
  /** People the old scorer credited with the run's country (it appeared anywhere in the profile). */
  oldScorerCreditedGeo: { total: number; actuallyOutside: number; actuallyUnknown: number; actuallyMatch: number };
  before: { scoreAtLeast50: GeoShares };
  after: { scoreAtLeast50: GeoShares; rejectedOutsideTarget: number; unknownCappedAtReview: number };
};

const THRESHOLD = 50;
const empty = (): GeoShares => ({ total: 0, match: 0, outside: 0, unknown: 0 });

function bump(shares: GeoShares, verdict: GeoVerdict): void {
  shares.total += 1;
  if (verdict === "match") shares.match += 1;
  else if (verdict === "outside") shares.outside += 1;
  else shares.unknown += 1;
}

const squash = (text: string): string => foldText(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whether the run's country is named anywhere in the text: the old scorer's notion of "matched". */
function mentionedAnywhere(snippet: string | null, targets: readonly string[]): boolean {
  const text = ` ${squash(snippet ?? "")} `;
  return targets.some((country) => countryVariants(country).some((name) => name.length > 2 && text.includes(` ${squash(name)} `)));
}

function toCandidate(row: PeopleEvalRow): ParsedCandidate {
  return {
    kind: "CONTACT",
    name: row.name,
    domain: null,
    // Every discovered contact is a LinkedIn profile; the evidence bonus the scorer gives one applies here too.
    linkedinUrl: "https://www.linkedin.com/in/eval",
    title: row.title,
    companyName: row.companyName,
    location: row.location,
    country: row.country,
    source: { query: "", url: "", snippet: row.snippet, provider: null },
    dedupeFingerprint: `eval:${row.name}`,
  };
}

export function buildPeopleEvalReport(
  rows: readonly PeopleEvalRow[],
  run: { targetCountries: string[]; personaTitles: string[]; hints: string[]; geoGate: boolean }
): PeopleEvalReport {
  const report: PeopleEvalReport = {
    targetCountries: run.targetCountries,
    total: rows.length,
    actual: empty(),
    oldScorerCreditedGeo: { total: 0, actuallyOutside: 0, actuallyUnknown: 0, actuallyMatch: 0 },
    before: { scoreAtLeast50: empty() },
    after: { scoreAtLeast50: empty(), rejectedOutsideTarget: 0, unknownCappedAtReview: 0 },
  };
  for (const row of rows) {
    const candidate = toCandidate(row);
    const truth = geoVerdictFor(currentProfileOf(candidate).country, run.targetCountries);
    const verdict: GeoVerdict = truth === "not_applicable" ? "unknown" : truth;
    bump(report.actual, verdict);

    if (mentionedAnywhere(row.snippet, run.targetCountries)) {
      const credited = report.oldScorerCreditedGeo;
      credited.total += 1;
      if (verdict === "outside") credited.actuallyOutside += 1;
      else if (verdict === "unknown") credited.actuallyUnknown += 1;
      else credited.actuallyMatch += 1;
    }
    if ((row.storedScore ?? 0) >= THRESHOLD) bump(report.before.scoreAtLeast50, verdict);

    const fit = scoreCandidateHeuristic(candidate, run.hints, {
      personaTitles: run.personaTitles,
      targetCountries: run.targetCountries,
      geoGate: run.geoGate,
    });
    if (fit.score >= THRESHOLD) bump(report.after.scoreAtLeast50, verdict);
    if (fit.rejection === "person_outside_target") report.after.rejectedOutsideTarget += 1;
    if (fit.geo === "unknown") report.after.unknownCappedAtReview += 1;
  }
  return report;
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`);

export function formatPeopleEvalReport(report: PeopleEvalReport): string {
  const line = (label: string, s: GeoShares) =>
    `${label.padEnd(34)} n=${String(s.total).padStart(4)}  in target ${pct(s.match, s.total).padStart(4)}  outside ${pct(s.outside, s.total).padStart(4)}  unknown ${pct(s.unknown, s.total).padStart(4)}`;
  const c = report.oldScorerCreditedGeo;
  return [
    `Target countries: ${report.targetCountries.join(", ") || "(none)"}`,
    line("All people returned", report.actual),
    line("Score >= 50, BEFORE (stored)", report.before.scoreAtLeast50),
    line("Score >= 50, AFTER (re-scored)", report.after.scoreAtLeast50),
    `Old scorer credited the country to ${c.total}: ${c.actuallyOutside} were outside it, ${c.actuallyUnknown} unstated, ${c.actuallyMatch} in it.`,
    `After: ${report.after.rejectedOutsideTarget} rejected as outside the target; ${report.after.unknownCappedAtReview} capped at review (country not stated).`,
  ].join("\n");
}
