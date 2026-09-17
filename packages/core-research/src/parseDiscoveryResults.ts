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
  // Split on "separator followed by whitespace"; the leading `\s*` the pattern used to carry is
  // redundant with the trim below and made the split quadratic on long runs of spaces.
  const segments = title.split(/[|\-–—:·]\s+/).map((s) => s.trim()).filter(Boolean);
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
//
// Parsed by splitting on the separator characters rather than with one anchored regex of lazy
// `.{2,60}?` groups and `\s*` on both sides of each separator — that shape backtracks
// polynomially on SERP titles, which the search provider controls (CodeQL js/polynomial-redos).
// Semantics are unchanged: first segment is the name, second the role, everything after the
// second separator is the company.
const LI_TITLE_SEPARATOR = /[-–—|]/;

function splitLinkedInTitle(title: string): { name: string; role: string; company: string | null } | null {
  const first = title.search(LI_TITLE_SEPARATOR);
  if (first === -1) return null;
  const name = title.slice(0, first).trim();
  const afterName = title.slice(first + 1);
  const second = afterName.search(LI_TITLE_SEPARATOR);
  const role = (second === -1 ? afterName : afterName.slice(0, second)).trim();
  const company = second === -1 ? null : afterName.slice(second + 1).trim();
  if (name.length < 2 || name.length > 60) return null;
  if (role.length < 2 || role.length > 80) return null;
  if (company !== null && (company.length < 2 || company.length > 80)) return null;
  return { name, role, company };
}

/** Cut a trailing "| LinkedIn …" suffix by index; `/\|\s*LinkedIn.*$/` rescans from every `|`. */
function stripLinkedInSuffix(value: string): string {
  const m = /\|\s*LinkedIn/i.exec(value);
  return m ? value.slice(0, m.index) : value;
}

const FRAGMENT_EDGE_CHARS = new Set(["|", "·", "•", ",", "-", "–", "—", " ", "\t", "\n", "\r", " "]);

/** Trim separator/space characters from both ends by index scan (no `[…]+$`). */
function trimFragmentEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && FRAGMENT_EDGE_CHARS.has(value[start]!)) start++;
  while (end > start && FRAGMENT_EDGE_CHARS.has(value[end - 1]!)) end--;
  return value.slice(start, end);
}

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
  // Degree-marker prefix: `^\s*` and `sep\s*` each run once per anchor; the whitespace
  // alternative is a single `\s`, not `\s+` — under /g a `\s+` is retried from every index of
  // a long run of spaces, which is quadratic. The later `\s+ → " "` collapse makes the
  // single-character form equivalent.
  const out = trimFragmentEdges(
    stripLinkedInSuffix(value)
      .replace(/\b\d[\d,.]*\+?\s*(?:mutual\s+)?(?:connections?|followers?)\b/gi, "")
      .replace(/(?:^\s*|[|·•,-]\s*|\s)(?:1st|2nd|3rd)\+?(?:\s+degree)?(?![\p{L}])/giu, " ")
      .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
      .replace(/\s+/g, " ")
  ).trim();
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
      // Exact host or a subdomain — `endsWith("linkedin.com")` also accepted `evillinkedin.com`.
      const host = u.hostname.toLowerCase();
      if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) continue;
      const m = u.pathname.match(/^\/in\/([^/]+)/i);
      slug = m ? m[1].toLowerCase() : null;
    } catch {
      continue;
    }
    if (!slug || seen.has(slug)) continue;
    // Not a person page (signup / jobs / hashtag / company / …), or a bare numeric slug.
    if (NON_PROFILE_SLUGS.has(slug) || /^\d+$/.test(slug)) continue;

    const cleanTitle = stripLinkedInSuffix(hit.title).trim();
    // Two title shapes, because two kinds of engine name a page differently.
    //
    // A keyword engine returns the SERP title — "Name - Role - Company | LinkedIn" — and there a
    // bare title means an index or listicle, which is why harvesting those produced junk contacts.
    // A neural provider returns the page's own title, which for a profile is just the person.
    // Measured against Exa with the query the planner emits (2026-09-17): every result was a real
    // `/in/<slug>` profile titled "Janson Seah", "Dorothy Yiu", "Sukhveer Singh Bajaj" — and every
    // one was discarded. That was the whole of "research for people doesn't work".
    //
    // The listicle guard survives intact: it now rests on `looksLikePersonName` over a
    // `/in/<slug>` URL, which a directory page fails on both counts. What is not done here is
    // guessing: a bare title carries no role, and mining one out of the snippet would put an
    // invented job title on a real person.
    const parsed = splitLinkedInTitle(cleanTitle);
    const name = parsed ? parsed.name : cleanTitle;
    if (!looksLikePersonName(name)) continue;
    // Middle segment = role; trailing "at Company" inside role also handled. Located with
    // `\s+(?:at|@)\s+` — a literal between two single quantifiers — instead of `(.+?)\s+…\s+(.+)`,
    // whose `.` also matches whitespace and backtracks polynomially.
    let role: string | null = parsed ? parsed.role : null;
    let company: string | null = parsed ? parsed.company : null;
    if (role && !company) {
      const at = /\s+(?:at|@)\s+/i.exec(role);
      if (at && at.index > 0 && at.index + at[0].length < role.length) {
        company = role.slice(at.index + at[0].length).trim();
        role = role.slice(0, at.index).trim();
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
