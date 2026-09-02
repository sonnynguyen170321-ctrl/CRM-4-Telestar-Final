import { lookupSeniority } from "../dictionaries/seniority";
import type { Department, SeniorityTier } from "../dictionaries/seniority";
import { foldText } from "./normalizeCountry";

// SC2: raw title -> { seniorityTier, department, keywords }.
// Delegates to the seniority taxonomy (EN + German). Pure.

export type NormalizedTitle = {
  rawTitle: string | null;
  titlePresent: boolean;
  seniorityTier: SeniorityTier;
  department: Department;
  matchedKeyword: string | null;
  keywords: string[];
};

const KEYWORD_SPLIT = /[\s,/&|()-]+/;

export function normalizeTitle(
  rawTitle: string | undefined | null
): NormalizedTitle {
  const raw = String(rawTitle ?? "").trim();

  if (!raw) {
    return {
      rawTitle: null,
      titlePresent: false,
      seniorityTier: "UNKNOWN",
      department: "UNKNOWN",
      matchedKeyword: null,
      keywords: [],
    };
  }

  const lookup = lookupSeniority(raw);
  const keywords = foldText(raw)
    .split(KEYWORD_SPLIT)
    .filter((token) => token.length > 1);

  return {
    rawTitle: raw,
    titlePresent: true,
    seniorityTier: lookup.tier,
    department: lookup.department,
    matchedKeyword: lookup.matchedKeyword,
    keywords,
  };
}
