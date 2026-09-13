import "server-only";

import { runCompanyResearch } from "@telestar/core-intel/runCompanyResearch";

// Lookalike seed comprehension. Before searching for peers we must know what the seed actually
// sells — otherwise brand-string queries just return the seed itself. This crawls the seed site
// (no API key needed) via the existing company-intelligence engine and derives readable
// industry/offering terms + a summary that drive attribute-based lookalike queries. Best-effort:
// any failure returns empties and the planner falls back to whatever the user typed.

export type SeedComprehension = { industries: string[]; keywords: string[]; summary: string | null };

const META_WORDS = new Set(["count", "confidence", "high", "medium", "low", "unknown", "none", "true", "false"]);
const SEED_CRAWL_TIMEOUT_MS = 9000;

function humanizeToken(token: string): string {
  const part = token.includes(".") ? token.slice(token.indexOf(".") + 1) : token;
  return part.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function usableTerms(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const term = humanizeToken(token);
    if (term.length < 2 || /\d/.test(term)) continue;
    if (term.split(" ").every((w) => META_WORDS.has(w))) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

export async function comprehendSeed(input: { name: string; domain: string | null }): Promise<SeedComprehension> {
  if (!input.domain) return { industries: [], keywords: [], summary: null };
  try {
    const result = await runCompanyResearch({
      companyName: input.name || input.domain,
      canonicalDomainInput: input.domain,
      websiteUrl: `https://${input.domain}`,
      fetchOptions: { timeoutMs: SEED_CRAWL_TIMEOUT_MS },
    });
    const cls = result.profile.classificationJson;
    return {
      industries: usableTerms(cls.industries).slice(0, 12),
      keywords: usableTerms(cls.offerings).slice(0, 12),
      summary: result.profile.companySummary,
    };
  } catch {
    return { industries: [], keywords: [], summary: null };
  }
}
