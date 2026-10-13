import { COUNTRY_NAMES_SHARED_WITH_US_STATES } from "@telestar/core-scoring/rules/dictionaries/countries";

import { resolveCountry } from "./rulesFromParams";

// What a neural people search says about WHO a person is and WHERE they are, read from the head of the
// profile text it returns (owner report, 2026-10-13).
//
// The old scorer counted the run's country as a keyword anywhere in a 1500-character, multi-passage
// highlight. A man in Wichita Falls, Texas, who once deployed to Afghanistan therefore "matched
// Afghanistan". A person has one current location and one current role, and both sit in the HEAD of the
// profile (name, headline, "City, Region, Country"); the experience history behind it is the past. So:
//
//   - only the head of the first passage is read for a location or a headline;
//   - a line that carries a year, a past-tense verb or a role title is never a location;
//   - when nothing in the head states a place, the answer is "unknown" -- never a guess.
//
// Pure: no I/O. Fail-soft: every function returns null rather than throwing on odd input.

export type PersonLocation = {
  /** The place as written, e.g. "Wichita Falls, Texas, United States". */
  location: string;
  /** Canonical country name, or null when the line names a place we cannot place in a country. */
  country: string | null;
};

export type PersonHeadline = {
  /** The headline line as written, e.g. "Director of Maintenance at Sheppard Air Force Base". */
  headline: string;
  /** The role part ("Director of Maintenance"), or null when the line is not "Role at Employer". */
  title: string | null;
  employer: string | null;
};

/** How much of the first passage is the head. A profile header is a few short lines. */
const HEAD_CHARS = 700;
const MAX_HEAD_PIECES = 10;
const PASSAGE_SEPARATOR = " … ";

const US_STATES = new Set(
  [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
    "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
    "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma",
    "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
    "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
  ].map((s) => s.toLowerCase()),
);

const CANADIAN_PROVINCES = new Set(
  [
    "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan", "Nova Scotia", "New Brunswick",
    "Newfoundland and Labrador", "Prince Edward Island",
  ].map((s) => s.toLowerCase()),
);

// Words that make a line a role or a story, not a place.
const ROLE_WORD =
  /(?<![\p{L}\p{N}])(director|manager|engineer|officer|president|head|chief|founder|owner|consultant|specialist|analyst|lead|vp|executive|supervisor|technician|mechanic|inspector|coordinator|administrator|partner|advisor|adviser|ceo|cto|cfo|coo)(?![\p{L}\p{N}])/iu;
const PAST_OR_PREPOSITION =
  /(?<![\p{L}\p{N}])(deployed|deployment|served|serving|worked|working|stationed|tour|operation|trip|travel|traveled|travelled|visited|moved|relocated|from|to|in|at|for|during|with|and|formerly|previously|ex)(?![\p{L}\p{N}])/iu;
const YEAR = /(?<!\d)(?:19|20)\d{2}(?!\d)/;
const SOCIAL_NOISE = /(connections?|followers?|contact info|open to work|mutual|degree|linkedin|premium|\bbio\b|about|experience|education)/i;
const GEORGIA_CITIES = new Set(["tbilisi", "batumi", "kutaisi", "rustavi", "gori", "zugdidi", "poti"]);

/** Cut a profile text into the short lines a header is made of. */
function headPieces(text: string | null | undefined): string[] {
  const first = String(text ?? "").split(PASSAGE_SEPARATOR)[0] ?? "";
  const head = first.slice(0, HEAD_CHARS);
  return head
    .split(/\r?\n|\s[·•|]\s|\s[–—-]\s|(?<=[\p{Ll}\p{N}\)])\.\s+(?=\p{Lu})/u)
    .map((piece) => piece.replace(/^[\s·•|-]+|[\s·•|.-]+$/g, "").trim())
    .filter(Boolean)
    .slice(0, MAX_HEAD_PIECES);
}

const LOCATION_LEAD_IN = /^(?:location|located|based|lives|living|resides|residing)(?:\s*[:]\s*|\s+in\s+)/i;
const looksCapitalised = (segment: string) => /^[\p{Lu}]/u.test(segment) || /^[\p{L}]+['’][\p{Lu}]/u.test(segment);

function countryOfSegments(segments: string[]): string | null {
  const last = segments[segments.length - 1] ?? "";
  // No two-letter codes: "MA" after a city is Massachusetts, "IN" is Indiana. A country is named in full.
  if (last.length >= 3) {
    const country = resolveCountry(last);
    if (country) {
      if (COUNTRY_NAMES_SHARED_WITH_US_STATES.includes(country) && segments.length > 1) {
        return GEORGIA_CITIES.has(segments[0]!.toLowerCase()) ? country : null;
      }
      return country;
    }
  }
  const lowered = last.toLowerCase();
  if (segments.length > 1 && US_STATES.has(lowered)) return "United States";
  if (segments.length > 1 && CANADIAN_PROVINCES.has(lowered)) return "Canada";
  return null;
}

const isDated = (piece: string | undefined): boolean => Boolean(piece && (YEAR.test(piece) || /(?<![\p{L}])present(?![\p{L}])/iu.test(piece)));

/** One header line as a location, or null when it is anything else. */
function asLocation(raw: string): PersonLocation | null {
  const piece = raw.replace(LOCATION_LEAD_IN, "").trim();
  if (piece.length < 3 || piece.length > 90) return null;
  if (YEAR.test(piece) || /\d/.test(piece) || SOCIAL_NOISE.test(piece)) return null;
  if (/\s(?:at|@)\s|@/.test(piece)) return null;
  const segments = piece.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0 || segments.length > 4) return null;
  for (const segment of segments) {
    if (segment.length > 40 || segment.split(/\s+/).length > 5 || !looksCapitalised(segment)) return null;
    if (ROLE_WORD.test(segment)) return null;
  }
  // "Deployed to Kabul, Afghanistan" is a story; the stop-words are only forbidden in the first segment,
  // because a real place may contain them further on ("Rio de Janeiro", "Bay of Plenty" are not stop-words
  // here, but "in", "to" and "at" never appear inside a place name).
  if (PAST_OR_PREPOSITION.test(segments[0]!) && !/^(?:rio de|bay of|isle of|city of)/i.test(segments[0]!)) return null;
  const country = countryOfSegments(segments);
  if (!country) {
    // A place the dictionary cannot put in a country ("Greater Seattle Area", "Dallas, Texas" handled above)
    // is kept as text only when it is plainly a place line, so the rep can still read it.
    return /\b(area|region|metropolitan|metroplex|greater)\b/i.test(piece) ? { location: piece, country: null } : null;
  }
  return { location: piece, country };
}

/**
 * The person's current location, from the head of their profile text.
 * Null when the head states none we can read -- unknown, never guessed.
 */
export function extractPersonLocation(text: string | null | undefined): PersonLocation | null {
  const pieces = headPieces(text);
  for (const [index, piece] of pieces.entries()) {
    // A place beside a date is a line of the work history ("Kandahar, Afghanistan · 2011"), not where the
    // person is now.
    if (isDated(pieces[index - 1]) || isDated(pieces[index + 1])) continue;
    const found = asLocation(piece);
    if (found) return found;
  }
  return null;
}

/**
 * The person's current headline, from the head of their profile text: the first line after the name that
 * is neither a location nor social-network noise. "Role at Employer" is split; anything else is kept whole.
 */
export function extractPersonHeadline(text: string | null | undefined, name: string | null | undefined): PersonHeadline | null {
  const foldedName = String(name ?? "").trim().toLowerCase();
  for (const piece of headPieces(text)) {
    const lowered = piece.toLowerCase();
    if (!lowered || lowered === foldedName || (foldedName && lowered.startsWith(`${foldedName} `) && lowered.length <= foldedName.length + 3)) continue;
    if (SOCIAL_NOISE.test(piece) || YEAR.test(piece)) continue;
    if (asLocation(piece)) continue;
    if (piece.length < 3 || piece.length > 160) continue;
    // Only a line that reads as a role is a headline; "Singapore" or a bare sentence is not.
    if (!ROLE_WORD.test(piece)) continue;
    const at = /^(.{2,100}?)\s+(?:at|@)\s+(.{2,100})$/iu.exec(piece);
    if (at) return { headline: piece, title: at[1]!.trim(), employer: at[2]!.trim() };
    return { headline: piece, title: piece, employer: null };
  }
  return null;
}
