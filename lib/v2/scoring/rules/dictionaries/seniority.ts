// SC1 reference dictionary: title -> seniority tier + department.
//
// Multilingual (EN + German for FlexEnergy). Powers persona seniority floors,
// seniority exclusions ("no manager" / "no engineer"), and department overrides
// ("HR/Admin: any level OK"). Versioned data — bump SENIORITY_DICTIONARY_VERSION on change.
// Pure data + pure helpers only.

export const SENIORITY_TIERS = [
  "C_LEVEL",
  "OWNER",
  "VP",
  "DIRECTOR",
  "HEAD",
  "LEAD",
  "MANAGER",
  "IC",
  "UNKNOWN",
] as const;

export type SeniorityTier = (typeof SENIORITY_TIERS)[number];

// Higher rank = more senior. seniorityFloor comparisons use this ordering.
// OWNER ranks alongside C_LEVEL (founder/owner). UNKNOWN is the floor.
export const SENIORITY_RANK: Record<SeniorityTier, number> = {
  C_LEVEL: 7,
  OWNER: 7,
  VP: 6,
  DIRECTOR: 5,
  HEAD: 4,
  LEAD: 3,
  MANAGER: 2,
  IC: 1,
  UNKNOWN: 0,
};

export const DEPARTMENTS = [
  "EXECUTIVE",
  "SALES",
  "MARKETING",
  "GROWTH",
  "BUSINESS_DEVELOPMENT",
  "PARTNERSHIPS",
  "IT",
  "ENGINEERING",
  "SECURITY",
  "PRODUCT",
  "OPERATIONS",
  "PRODUCTION",
  "HR",
  "FINANCE",
  "ADMIN",
  "CUSTOMER",
  "LEGAL",
  "UNKNOWN",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

type SeniorityEntry = {
  // Lowercased substrings; first matching entry wins (ordered most-specific first).
  match: readonly string[];
  tier: SeniorityTier;
  department: Department;
};

// Order matters: more specific / more senior phrases first so "head of sales"
// resolves to HEAD+SALES before a bare "sales" -> IC+SALES fallback.
export const SENIORITY_TAXONOMY: readonly SeniorityEntry[] = [
  // C-level (EN)
  { match: ["chief executive", "ceo"], tier: "C_LEVEL", department: "EXECUTIVE" },
  { match: ["chief operating", "coo"], tier: "C_LEVEL", department: "OPERATIONS" },
  { match: ["chief revenue", "cro"], tier: "C_LEVEL", department: "SALES" },
  { match: ["chief marketing", "cmo"], tier: "C_LEVEL", department: "MARKETING" },
  { match: ["chief technology", "cto"], tier: "C_LEVEL", department: "ENGINEERING" },
  { match: ["chief information security", "ciso"], tier: "C_LEVEL", department: "SECURITY" },
  { match: ["chief information", "cio"], tier: "C_LEVEL", department: "IT" },
  { match: ["chief financial", "cfo"], tier: "C_LEVEL", department: "FINANCE" },
  { match: ["chief commercial", "cco"], tier: "C_LEVEL", department: "SALES" },
  { match: ["chief product", "cpo"], tier: "C_LEVEL", department: "PRODUCT" },
  { match: ["chief"], tier: "C_LEVEL", department: "EXECUTIVE" },
  // Owner / founder
  { match: ["founder", "co-founder", "cofounder", "owner", "proprietor"], tier: "OWNER", department: "EXECUTIVE" },
  // German C-level / executive (FlexEnergy)
  { match: ["geschäftsleitung", "geschaeftsleitung", "geschäftsführer", "geschaeftsfuehrer"], tier: "C_LEVEL", department: "EXECUTIVE" },
  // VP
  { match: ["vice president", "vp ", "svp", "evp", "vp of", "vp,"], tier: "VP", department: "UNKNOWN" },
  // Director (EN + German "Direktor")
  { match: ["managing director"], tier: "C_LEVEL", department: "EXECUTIVE" },
  { match: ["director of sales", "sales director"], tier: "DIRECTOR", department: "SALES" },
  { match: ["director of business development", "business development director"], tier: "DIRECTOR", department: "BUSINESS_DEVELOPMENT" },
  { match: ["it director", "director of it"], tier: "DIRECTOR", department: "IT" },
  { match: ["creative director"], tier: "DIRECTOR", department: "MARKETING" },
  { match: ["marketing director"], tier: "DIRECTOR", department: "MARKETING" },
  { match: ["hr director", "director of hr"], tier: "DIRECTOR", department: "HR" },
  { match: ["factory director", "plant director", "production director"], tier: "DIRECTOR", department: "PRODUCTION" },
  { match: ["direktor", "direktorin"], tier: "DIRECTOR", department: "EXECUTIVE" },
  { match: ["director"], tier: "DIRECTOR", department: "UNKNOWN" },
  // Head
  { match: ["head of sales development", "head of sales dev"], tier: "HEAD", department: "SALES" },
  { match: ["head of growth", "head of business development"], tier: "HEAD", department: "GROWTH" },
  { match: ["head of sales"], tier: "HEAD", department: "SALES" },
  { match: ["head of marketing"], tier: "HEAD", department: "MARKETING" },
  { match: ["head of it", "head of infrastructure", "head of infra"], tier: "HEAD", department: "IT" },
  { match: ["head of hr", "head of people"], tier: "HEAD", department: "HR" },
  { match: ["head of"], tier: "HEAD", department: "UNKNOWN" },
  { match: ["leiter", "leiterin"], tier: "HEAD", department: "UNKNOWN" }, // German "Leiter X"
  // Lead (incl. tech lead)
  { match: ["tech lead", "technical lead", "team lead", "lead of"], tier: "LEAD", department: "ENGINEERING" },
  { match: ["lead"], tier: "LEAD", department: "UNKNOWN" },
  // Manager
  { match: ["hr manager", "people manager"], tier: "MANAGER", department: "HR" },
  { match: ["operations manager", "ops manager"], tier: "MANAGER", department: "OPERATIONS" },
  { match: ["store manager", "restaurant manager", "workforce manager", "staffing manager"], tier: "MANAGER", department: "OPERATIONS" },
  { match: ["it manager"], tier: "MANAGER", department: "IT" },
  { match: ["digital manager", "innovation manager", "product manager", "produktmanager"], tier: "MANAGER", department: "PRODUCT" },
  { match: ["manager"], tier: "MANAGER", department: "UNKNOWN" },
  // Individual contributor signals (engineers, admins, specialists)
  { match: ["software engineer", "engineer", "developer"], tier: "IC", department: "ENGINEERING" },
  { match: ["system admin", "network engineer", "network operator", "sysadmin"], tier: "IC", department: "IT" },
  { match: ["security engineer", "soc analyst"], tier: "IC", department: "SECURITY" },
  { match: ["chief accountant", "accountant"], tier: "IC", department: "FINANCE" },
  { match: ["hr executive", "human resources executive", "people executive"], tier: "IC", department: "HR" },
  { match: ["admin executive", "administrative executive"], tier: "IC", department: "ADMIN" },
  { match: ["admin", "administrative", "administration"], tier: "IC", department: "ADMIN" },
  { match: ["specialist", "associate", "assistant", "coordinator", "executive"], tier: "IC", department: "UNKNOWN" },
];

export const SENIORITY_DICTIONARY_VERSION = "seniority-v1";

export type SeniorityLookup = {
  tier: SeniorityTier;
  department: Department;
  matchedKeyword: string | null;
};

/**
 * Match a taxonomy keyword against an already-lowercased title.
 * 2-3 letter acronyms (ceo, coo, cco, vp, cto…) must match as a WHOLE WORD — otherwise
 * they false-fire as substrings: "cco" inside "a-cco-unt", "coo" inside "co-o-rdinator",
 * "cro" inside "mi-cro-soft" — which mis-classified Account Executives / Managers as
 * C_LEVEL. Longer keywords and multi-word phrases stay substring matches (safe).
 */
export function matchesSeniorityKeyword(lowerTitle: string, keyword: string): boolean {
  const kw = keyword.trim();
  if (/^[a-z]{2,3}$/.test(kw)) {
    return new RegExp(`\\b${kw}\\b`).test(lowerTitle);
  }
  return lowerTitle.includes(keyword);
}

/**
 * Resolve a raw title into a seniority tier + department.
 * Ordered taxonomy, first hit wins; acronyms match whole-word (see matchesSeniorityKeyword).
 * Returns UNKNOWN/UNKNOWN with matchedKeyword=null when nothing matches.
 */
export function lookupSeniority(rawTitle: string): SeniorityLookup {
  const title = String(rawTitle ?? "").trim().toLowerCase();

  if (!title) {
    return { tier: "UNKNOWN", department: "UNKNOWN", matchedKeyword: null };
  }

  for (const entry of SENIORITY_TAXONOMY) {
    for (const keyword of entry.match) {
      if (matchesSeniorityKeyword(title, keyword)) {
        return {
          tier: entry.tier,
          department: entry.department,
          matchedKeyword: keyword,
        };
      }
    }
  }

  return { tier: "UNKNOWN", department: "UNKNOWN", matchedKeyword: null };
}

/** True when `candidate` is at least as senior as `floor`. */
export function meetsSeniorityFloor(
  candidate: SeniorityTier,
  floor: SeniorityTier
): boolean {
  return SENIORITY_RANK[candidate] >= SENIORITY_RANK[floor];
}
