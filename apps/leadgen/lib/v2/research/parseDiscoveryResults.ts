// The native research engine's harvester: turns public SERP results into structured
// candidates. Company candidates come from result domains (aggregators/socials excluded);
// contact candidates from LinkedIn-person results, parsed from the public title pattern
// "Name - Title - Company | LinkedIn". SERP titles/snippets only — no page scraping. Pure.

export type RawSearchHit = {
  title: string;
  url: string;
  snippet: string | null;
  provider: string | null;
};

export type ParsedCandidate = {
  kind: "COMPANY" | "CONTACT";
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  title: string | null;
  companyName: string | null;
  location: string | null;
  source: { query: string; url: string; snippet: string | null; provider: string | null };
  dedupeFingerprint: string;
};

// Domains that are never the prospect itself. Single source of truth — candidateIdentity imports this
// rather than keeping a second hand-maintained copy (the two used to drift independently).
export const EXCLUDED_HOSTS = new Set([
  "linkedin.com", "facebook.com", "x.com", "twitter.com", "instagram.com", "youtube.com",
  "wikipedia.org", "crunchbase.com", "glassdoor.com", "indeed.com", "g2.com", "capterra.com",
  "clutch.co", "medium.com", "reddit.com", "quora.com", "github.com", "apple.com",
  "google.com", "bing.com", "yelp.com", "trustpilot.com", "bloomberg.com", "reuters.com",
  "forbes.com", "techcrunch.com", "businesswire.com", "prnewswire.com", "zoominfo.com",
  "apollo.io", "lusha.com", "signalhire.com", "rocketreach.co", "theorg.com", "owler.com",
  // Software-review / directory / listicle / tech-media sites — a "directory-style" discovery query
  // ("top SaaS companies") lands on these, and their own domain is never the prospect company.
  "builtin.com", "producthunt.com", "softwareadvice.com", "getapp.com", "saashub.com",
  "trustradius.com", "saasworthy.com", "financesonline.com", "sourceforge.net", "gartner.com",
  "techradar.com", "pcmag.com", "cnet.com", "zdnet.com", "wired.com", "venturebeat.com",
  "producthunt.net", "slashdot.org", "trustpilot.co.uk",
]);

// A SERP result whose TITLE is a listicle / roundup / comparison / review — the page is a SOURCE of
// company links, never a company itself. "top 10 SaaS companies", "10 Best CRM (2024)", "X vs Y",
// "Salesforce alternatives" must not be harvested as company candidates (they even out-ranked real
// companies because the roundup title is stuffed with the ICP keyword). Conservative: only strong
// listicle/comparison/alternatives shapes, so a real company's /pricing or /reviews subpage still passes.
const LISTICLE_TITLE_RE =
  /\b(top|best|leading)\s+\d+\b|^\s*\d+\s+(best|top|leading|popular|great|essential)\b|\b\d+\s+(?:best|top)\b|\blist of\b|\b(alternatives|vs\.?|versus)\b/i;

export function looksLikeListicleResult(title: string): boolean {
  return LISTICLE_TITLE_RE.test(String(title ?? ""));
}

function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function cleanCompanyName(title: string, domain: string): string {
  // SERP titles look like "Acme Corp — Payments infrastructure for platforms" or
  // "Payments infrastructure for platforms | Acme Corp". Picking the first non-generic segment gave
  // the marketing tagline as the "company name". Prefer the segment matching the domain stem (that is
  // the real name), else the shortest plausible segment (a name is shorter than a tagline).
  const segments = title.split(/\s*[|\-–—:·]\s+/).map((s) => s.trim()).filter(Boolean);
  const generic = /^(home|homepage|welcome|about( us)?|official (site|website)|contact|pricing|products?|solutions?|blog|login|sign ?in)$/i;
  const fold = (s: string) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const stem = fold(domain.split(".")[0]);
  const plausible = segments.filter(
    (s) => !generic.test(s) && !looksLikeListicleResult(s) && s.length >= 2 && s.length <= 80
  );
  const domainMatch = plausible.find((s) => {
    const f = fold(s);
    return f.length >= 2 && stem.length >= 2 && (f.includes(stem) || stem.includes(f));
  });
  if (domainMatch) return domainMatch;
  const shortest = [...plausible].sort((a, b) => a.length - b.length)[0];
  if (shortest) return shortest;
  // Fallback: derive from domain ("acme-corp" -> "Acme Corp").
  const label = domain.split(".")[0].replace(/[-_]+/g, " ");
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseCompanyHits(query: string, hits: RawSearchHit[], excludeRoots: string[] = []): ParsedCandidate[] {
  const out: ParsedCandidate[] = [];
  const seen = new Set<string>();
  // Roots we must never harvest — e.g. the lookalike seed's own domain, or already-known
  // companies passed by the caller. Normalized to root form for comparison.
  const excluded = new Set(excludeRoots.map((d) => rootDomain(d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])));
  for (const hit of hits) {
    const host = hostOf(hit.url);
    if (!host) continue;
    const root = rootDomain(host);
    if (EXCLUDED_HOSTS.has(root)) continue;
    if (excluded.has(root)) continue;
    // A listicle / roundup / comparison page is a source of links, not a company candidate.
    if (looksLikeListicleResult(hit.title)) continue;
    if (seen.has(root)) continue;
    seen.add(root);
    out.push({
      kind: "COMPANY",
      name: cleanCompanyName(hit.title, root),
      domain: root,
      linkedinUrl: null,
      title: null,
      companyName: null,
      location: null,
      source: { query, url: hit.url, snippet: hit.snippet, provider: hit.provider },
      dedupeFingerprint: `company:${root}`,
    });
  }
  return out;
}

// Public LinkedIn SERP title patterns:
//   "Anna Tran - VP Sales - Acme Corp | LinkedIn"
//   "Anna Tran – VP Sales at Acme | LinkedIn"
const LI_TITLE_RE = /^(.{2,60}?)\s*[-–—|]\s*(.{2,80}?)(?:\s*[-–—|]\s*(.{2,80}?))?\s*(?:\|\s*LinkedIn.*)?$/i;

// linkedin.com/in/<slug> paths that are not a person. SERPs return these constantly and they used to
// be harvested as "people" (a hashtag page became a contact named "#salesjobs").
const NON_PROFILE_SLUGS = new Set([
  "signup", "sign-up", "login", "log-in", "jobs", "job", "hashtag", "company", "companies",
  "school", "feed", "pulse", "posts", "post", "directory", "help", "legal", "privacy", "about",
  "search", "learning", "groups", "events", "newsletters", "unsubscribe",
]);

// Listicle / index-page openers that are never a person's name.
const NON_PERSON_PHRASE_RE =
  /^(top\s+\d+|\d+\s+best|best\s+\d+|list of|jobs? in|hiring|meet the|our team|our people|the team|people (?:at|of)|contact us|about us|view profile|members?|sign[\s-]?up|log[\s-]?in)\b/i;

/**
 * Whether a harvested string plausibly names a human. The SERP harvester previously fell back to the
 * whole page title when the LinkedIn title pattern didn't match, which turned listicles, job feeds and
 * LinkedIn's own signup page into "contacts". Deliberately permissive about scripts (Vietnamese,
 * accents, CJK) and strict about the shapes that mark a page title rather than a person.
 */
/**
 * Strip the boilerplate LinkedIn SERP titles drag into role/company. Only "| LinkedIn" used to be
 * removed, so companies were persisted as "Vinamilk | 500+ connections". Also drops degree markers
 * ("· 3rd+"), follower/connection counts, emoji and dangling separators.
 */
export function cleanSerpFragment(value: string | null | undefined): string | null {
  if (!value) return null;
  const out = value
    .replace(/\|\s*LinkedIn.*$/i, "")
    .replace(/\b\d[\d,.]*\+?\s*(?:mutual\s+)?(?:connections?|followers?)\b/gi, "")
    .replace(/(?:^|[\s|·•,-])\s*(?:1st|2nd|3rd)\+?(?:\s+degree)?(?![\p{L}])/giu, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[|·•,\-–—\s]+|[|·•,\-–—\s]+$/g, "")
    .trim();
  return out.length >= 2 ? out : null;
}

export function looksLikePersonName(value: string): boolean {
  const name = value.trim();
  if (name.length < 2 || name.length > 60) return false;
  if (/\d/.test(name)) return false; // "Top 10 …", "(20+) …"
  if (/[#@|•·/\\<>{}[\]()]/.test(name)) return false; // "#salesjobs", "(20+) …"
  if (NON_PERSON_PHRASE_RE.test(name)) return false;
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false; // real names are 2-5 tokens
  // Every token must start with a letter (any script).
  return tokens.every((t) => /^\p{L}/u.test(t));
}

export function parseContactHits(query: string, hits: RawSearchHit[]): ParsedCandidate[] {
  const out: ParsedCandidate[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    let slug: string | null = null;
    try {
      const u = new URL(hit.url);
      if (!u.hostname.toLowerCase().endsWith("linkedin.com")) continue;
      const m = u.pathname.match(/^\/in\/([^/]+)/i);
      slug = m ? m[1].toLowerCase() : null;
    } catch {
      continue;
    }
    if (!slug || seen.has(slug)) continue;
    // Not a person page (signup / jobs / hashtag / company / …), or a bare numeric slug.
    if (NON_PROFILE_SLUGS.has(slug) || /^\d+$/.test(slug)) continue;

    const cleanTitle = hit.title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
    const m = cleanTitle.match(LI_TITLE_RE);
    // No fallback to the raw page title: if the "Name - Role - Company" shape isn't there, this is an
    // index/listicle/utility page, not a profile. Harvesting it produced the junk contacts.
    if (!m) continue;
    const name = (m[1] ?? "").trim();
    if (!looksLikePersonName(name)) continue;
    // Middle segment = role; trailing "at Company" inside role also handled.
    let role: string | null = m[2]?.trim() ?? null;
    let company: string | null = m[3]?.trim() ?? null;
    if (role && !company) {
      const at = role.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
      if (at) {
        role = at[1].trim();
        company = at[2].trim();
      }
    }
    role = cleanSerpFragment(role);
    company = cleanSerpFragment(company);
    seen.add(slug);
    out.push({
      kind: "CONTACT",
      name,
      domain: null,
      linkedinUrl: `https://www.linkedin.com/in/${slug}`,
      title: role,
      companyName: company,
      location: null,
      source: { query, url: hit.url, snippet: hit.snippet, provider: hit.provider },
      dedupeFingerprint: `contact:linkedin:${slug}`,
    });
  }
  return out;
}
