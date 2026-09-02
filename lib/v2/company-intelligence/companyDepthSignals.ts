import type { FetchStatus } from "./fetchWebsite";
import type { PageModel } from "./reasoning/pageModel";

export type CompanyDepthTerminalState =
  | "ENRICHED"
  | "PARTIAL"
  | "NO_DOMAIN"
  | "NO_WEBSITE"
  | "WAF_BLOCKED"
  | "PARKED"
  | "TIMEOUT"
  | "FAILED";

export type CompanyDepthEmailSignal = {
  email: string;
  localPart: string;
  domain: string;
  isRole: boolean;
  sourceUrl: string;
};

export type CompanyDepthSignals = {
  terminalState: CompanyDepthTerminalState;
  publicEmails: CompanyDepthEmailSignal[];
  personalEmails: CompanyDepthEmailSignal[];
  roleEmails: CompanyDepthEmailSignal[];
  phones: Array<{ value: string; sourceUrl: string }>;
  addresses: Array<{ value: string; sourceUrl: string }>;
  teamHints: Array<{ name: string; title: string; sourceUrl: string }>;
  learnedEmailPatterns: Array<{ pattern: string; sampleCount: number; confidence: number }>;
};

const ROLE_LOCAL_PARTS = new Set([
  "admin",
  "billing",
  "careers",
  "contact",
  "hello",
  "hr",
  "info",
  "jobs",
  "marketing",
  "media",
  "office",
  "press",
  "sales",
  "security",
  "support",
  "team",
]);

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const ADDRESS_RE = /\b\d{1,6}\s+[A-Z][A-Za-z0-9.' -]{2,}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Suite|Floor)\b[^.!?\n]{0,90}/gi;
const TEAM_LINE_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:-|,|\|)\s+((?:Chief|CEO|CTO|CFO|COO|CMO|VP|Vice President|Founder|Co-Founder|Head|Director|Manager|President)[^.\n]{0,80})/g;

export function deriveCompanyDepthTerminalState(input: {
  status: FetchStatus;
  canonicalDomain: string | null;
  websiteUrl: string | null;
  pagesWithContent: number;
  searchResultsCount: number;
}): CompanyDepthTerminalState {
  if (!input.canonicalDomain) return "NO_DOMAIN";
  if (!input.websiteUrl) return "NO_WEBSITE";
  if (input.status === "BLOCKED") return "WAF_BLOCKED";
  if (input.status === "PARKED") return "PARKED";
  if (input.status === "TIMEOUT") return "TIMEOUT";
  if (input.status === "SUCCESS" && input.pagesWithContent > 0) return "ENRICHED";
  if (input.status === "PARTIAL" || input.status === "JS_RENDER_REQUIRED" || input.searchResultsCount > 0) return "PARTIAL";
  return "FAILED";
}

export function extractCompanyDepthSignals(input: {
  pages: PageModel[];
  canonicalDomain: string;
  status: FetchStatus;
  websiteUrl: string | null;
  searchResultsCount: number;
}): CompanyDepthSignals {
  const pagesWithContent = input.pages.filter((page) => page.mainText.length > 0).length;
  const terminalState = deriveCompanyDepthTerminalState({
    status: input.status,
    canonicalDomain: input.canonicalDomain,
    websiteUrl: input.websiteUrl,
    pagesWithContent,
    searchResultsCount: input.searchResultsCount,
  });
  const publicEmails = dedupeByEmail(input.pages.flatMap(extractEmails));
  const roleEmails = publicEmails.filter((email) => email.isRole);
  const personalEmails = publicEmails.filter((email) => !email.isRole);
  const phones = dedupeValues(input.pages.flatMap(extractPhones));
  const addresses = dedupeValues(input.pages.flatMap(extractAddresses));
  const teamHints = dedupeTeamHints(input.pages.flatMap(extractTeamHints));

  return {
    terminalState,
    publicEmails,
    personalEmails,
    roleEmails,
    phones,
    addresses,
    teamHints,
    learnedEmailPatterns: learnEmailPatterns(personalEmails, input.canonicalDomain),
  };
}

function extractEmails(page: PageModel): CompanyDepthEmailSignal[] {
  return Array.from(page.mainText.matchAll(EMAIL_RE)).map((match) => {
    const email = match[0].toLowerCase();
    const [localPart, domain] = email.split("@");
    return {
      email,
      localPart,
      domain,
      isRole: ROLE_LOCAL_PARTS.has(localPart) || localPart.includes("+"),
      sourceUrl: page.url,
    };
  });
}

function extractPhones(page: PageModel): Array<{ value: string; sourceUrl: string }> {
  return Array.from(page.mainText.matchAll(PHONE_RE))
    .map((match) => ({ value: normalizePhone(match[0]), sourceUrl: page.url }))
    .filter((item) => item.value.replace(/\D/g, "").length >= 8);
}

function extractAddresses(page: PageModel): Array<{ value: string; sourceUrl: string }> {
  return Array.from(page.mainText.matchAll(ADDRESS_RE)).map((match) => ({
    value: match[0].replace(/\s+/g, " ").trim(),
    sourceUrl: page.url,
  }));
}

function extractTeamHints(page: PageModel): Array<{ name: string; title: string; sourceUrl: string }> {
  const text = [page.h1, ...page.h2s, ...page.jsonLdDescriptions, page.mainText].filter(Boolean).join("\n");
  return Array.from(text.matchAll(TEAM_LINE_RE)).map((match) => ({
    name: match[1].trim(),
    title: match[2].replace(/\s+/g, " ").trim(),
    sourceUrl: page.url,
  }));
}

function learnEmailPatterns(emails: CompanyDepthEmailSignal[], canonicalDomain: string) {
  const counts = new Map<string, number>();
  for (const email of emails) {
    if (email.domain !== canonicalDomain) continue;
    const pattern = patternForLocalPart(email.localPart);
    if (!pattern) continue;
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  return [...counts.entries()].map(([pattern, sampleCount]) => ({
    pattern,
    sampleCount,
    confidence: Math.min(95, 70 + sampleCount * 5),
  }));
}

function patternForLocalPart(localPart: string): string | null {
  if (/^[a-z]+[._-][a-z]+$/.test(localPart)) {
    const separator = localPart.match(/[._-]/)?.[0] ?? ".";
    return `first${separator}last`;
  }
  if (/^[a-z][a-z]+$/.test(localPart)) return "first";
  if (/^[a-z][._-][a-z]+$/.test(localPart)) {
    const separator = localPart.match(/[._-]/)?.[0] ?? ".";
    return `first_initial${separator}last_initial`;
  }
  if (/^[a-z][a-z]+[._-][a-z]$/.test(localPart)) {
    const separator = localPart.match(/[._-]/)?.[0] ?? ".";
    return `first${separator}last_initial`;
  }
  if (/^[a-z][._-][a-z][a-z]+$/.test(localPart)) {
    const separator = localPart.match(/[._-]/)?.[0] ?? ".";
    return `first_initial${separator}last`;
  }
  return null;
}

function dedupeByEmail(values: CompanyDepthEmailSignal[]): CompanyDepthEmailSignal[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.email)) return false;
    seen.add(value.email);
    return true;
  });
}

function dedupeValues<T extends { value: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function dedupeTeamHints(values: Array<{ name: string; title: string; sourceUrl: string }>) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.name.toLowerCase()}::${value.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+(). -]/g, "").replace(/\s+/g, " ").trim();
}
