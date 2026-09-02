import { cleanSerpFragment, looksLikePersonName } from "./parseDiscoveryResults";

export type CompanyPersonCandidate = {
  name: string;
  title: string;
  companyName: string;
  linkedinUrl: string | null;
  sourceUrl: string | null;
  confidence: number;
  reason: string;
};

// Unicode word boundaries (not \b, which is ASCII-only) so Vietnamese titles match. Vietnamese
// decision-maker titles were previously rejected outright: "Giám đốc kinh doanh" (Sales Director) and
// "Tổng giám đốc" (CEO) both failed the English-only gate.
const TARGET_TITLE_RE =
  /(?<![\p{L}\p{N}])(ceo|chief|founder|co-founder|owner|president|vp|vice president|head|director|manager|revenue|sales|marketing|growth|operations|engineering|product|finance|security|it|technology|giám đốc|trưởng phòng|trưởng bộ phận|chủ tịch|nhà sáng lập|quản lý|phụ trách|kinh doanh|tiếp thị)(?![\p{L}\p{N}])/iu;
const REJECT_TITLE_RE =
  /(?<![\p{L}\p{N}])(assistant to|executive assistant|personal assistant|office of|advisor to|student|intern|recruiter|thực tập sinh|trợ lý|sinh viên)(?![\p{L}\p{N}])/iu;
// Name part is Unicode-aware (\p{Lu} + \p{Ll}/\p{M}) rather than [A-Z][a-z]+, which silently skipped
// every accented Vietnamese name \u2014 "Nguy\u1ec5n V\u0103n Minh" and "Tr\u1ea7n Th\u1ecb H\u01b0\u01a1ng" were invisible to discovery
// while their ASCII-transliterated equivalents matched (Inv 11). \p{M} covers NFD-decomposed accents.
const LINKEDIN_SNIPPET_RE =
  /(?<![\p{L}\p{N}])(\p{Lu}[\p{Ll}\p{M}]+(?:\s+\p{Lu}[\p{Ll}\p{M}]+){1,3})\s+[-\u2013\u2014]\s+([^|\u2022\n]{2,90})\s+(?:at|@)\s+([^|\u2022\n]{2,90})/gu;

export function discoverPeopleAtCompany(input: {
  companyName: string;
  companyCandidateId: string;
  domain: string | null;
  sourceCoverage: Record<string, unknown>;
}): CompanyPersonCandidate[] {
  const fromTeam = readArray(input.sourceCoverage.teamHints).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl : null;
    return looksLikePersonName(name) && isTargetTitle(title)
      ? [{ name, title, companyName: input.companyName, linkedinUrl: null, sourceUrl, confidence: 70, reason: "company_page_team_hint" }]
      : [];
  });

  const fromLinkedIn = readArray(input.sourceCoverage.searchResults).flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const text = [item.title, item.snippet, item.highlight].filter((value): value is string => typeof value === "string").join(" ");
    const url = typeof item.url === "string" && item.url.includes("linkedin.com/in/") ? item.url : null;
    return extractLinkedInPeopleFromText(text, input.companyName, url);
  });

  return dedupePeople([...fromTeam, ...fromLinkedIn]).slice(0, 25);
}

export function extractLinkedInPeopleFromText(text: string, companyName: string, linkedinUrl: string | null): CompanyPersonCandidate[] {
  const out: CompanyPersonCandidate[] = [];
  for (const match of text.matchAll(LINKEDIN_SNIPPET_RE)) {
    const name = match[1].trim();
    const title = (cleanSerpFragment(match[2]) ?? match[2]).trim();
    // Strip "| LinkedIn", connection counts, degree markers, emoji from the company fragment.
    const company = cleanSerpFragment(match[3]) ?? "";
    if (!looksLikePersonName(name) || !isTargetTitle(title)) continue;
    out.push({
      name,
      title,
      companyName: company || companyName,
      linkedinUrl,
      sourceUrl: linkedinUrl,
      confidence: linkedinUrl ? 78 : 62,
      reason: "linkedin_public_snippet",
    });
  }
  return out;
}

export function isTargetTitle(title: string | null | undefined): boolean {
  const value = (title ?? "").trim();
  if (!value) return false;
  if (REJECT_TITLE_RE.test(value)) return false;
  return TARGET_TITLE_RE.test(value);
}

export function personDedupeFingerprint(input: { runId: string; companyCandidateId: string; name: string; title: string; linkedinUrl: string | null }) {
  if (input.linkedinUrl) return `contact:linkedin:${input.linkedinUrl.toLowerCase().replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}`;
  return `contact:company:${input.companyCandidateId}:${slug(input.name)}:${slug(input.title)}`;
}

function dedupePeople(values: CompanyPersonCandidate[]): CompanyPersonCandidate[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.linkedinUrl ?? ""}::${value.name.toLowerCase()}::${value.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
