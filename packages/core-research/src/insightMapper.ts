// Pure mapper: company-research profile facts -> compact business-insight for a research
// candidate. No server-only/prisma import so it is offline-testable. Fact tokens are controlled
// dotted snake_case (e.g. "offering.payment_gateway", "geo.hq_country_vietnam",
// "size.employee_count_51_200"); we humanize the tail into readable business language.
//
// Wording matters here because this text is what the SDR reads. Naive de-snake-casing produced
// "51 200" (a range whose separator was lost), "vietnam" (uncapitalised) and "recent" (from
// news.recent — meaningless on its own), so tokens are formatted, not just de-underscored.

export type CandidateInsight = {
  summary: string | null;
  whatTheySell: string[];
  industry: string[];
  size: string | null;
  hq: string | null;
  geoMarkets: string[];
  signals: string[];
  citations: Array<{ url: string; title: string | null }>;
};

export type InsightProfileInput = {
  companySummary: string | null;
  factsJson: string[];
  classificationJson: { offerings: string[]; industries: string[]; geographies: string[] };
  evidenceItemsJson?: Array<{ url?: string | null; sourceUrl?: string | null; title?: string | null }>;
};

// Terms that must not be title-cased into "Saas" / "Fmcg".
const ACRONYMS: Record<string, string> = {
  saas: "SaaS", cpg: "CPG", fmcg: "FMCG", crm: "CRM", erp: "ERP", api: "API", iot: "IoT",
  hr: "HR", it: "IT", ai: "AI", ml: "ML", b2b: "B2B", b2c: "B2C", b2b2c: "B2B2C", bpo: "BPO",
  msp: "MSP", cdp: "CDP", qsr: "QSR", pos: "POS", sme: "SME", smb: "SMB", usa: "USA", uk: "UK",
  ehr: "EHR", siem: "SIEM", ats: "ATS", hris: "HRIS", psp: "PSP", "3pl": "3PL",
};

// Whole tokens whose literal reading is wrong or unhelpful.
const TOKEN_LABELS: Record<string, string> = {
  "news.recent": "Recent news",
  "growth.funding": "Funding round",
  "growth.expansion": "Expansion",
  "growth.hiring_real": "Actively hiring",
  "maturity.hiring": "Actively hiring",
  "maturity.has_pricing_page": "Public pricing",
  "maturity.has_case_studies": "Case studies",
  "proof.case_study": "Case studies",
  "proof.customer_logo": "Named customers",
  "proof.has_partnerships": "Partnerships",
  "industry.food_beverage": "Food & Beverage",
  "risk.service_product_ambiguity": "Risk: service/product ambiguity",
};

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "51_200" -> "51–200 employees"; "354" -> "354 employees". */
function formatEmployeeCount(tail: string): string | null {
  const range = tail.match(/^(\d[\d,]*)_(\d[\d,]*)$/);
  if (range) return `${range[1]}–${range[2]} employees`;
  const single = tail.match(/^(\d[\d,]*)\+?$/);
  return single ? `${single[1]} employees` : null;
}

export function humanize(token: string): string {
  const exact = TOKEN_LABELS[token];
  if (exact) return exact;

  const prefix = token.includes(".") ? token.slice(0, token.indexOf(".") + 1) : "";
  const tail = token.includes(".") ? token.slice(token.indexOf(".") + 1) : token;

  if (tail.startsWith("employee_count_")) {
    const formatted = formatEmployeeCount(tail.slice("employee_count_".length));
    if (formatted) return formatted;
  }

  const stripped = tail.replace(/^(hq_country_|country_|market_|employee_count_|revenue_)/, "");
  const readable = titleCase(stripped.replace(/_/g, " ").trim());
  // risk.* reads as a warning, not a bare noun.
  return prefix === "risk." ? `Risk: ${readable}` : readable;
}

function firstWithPrefix(facts: string[], prefix: string): string | null {
  const hit = facts.find((f) => f.startsWith(prefix));
  return hit ? humanize(hit) : null;
}

function uniqueHumanized(tokens: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const term = humanize(token);
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

export function mapProfileToInsight(input: InsightProfileInput): CandidateInsight {
  const facts = input.factsJson ?? [];
  const signals = uniqueHumanized(
    facts.filter((f) => f.startsWith("news.") || f.startsWith("risk.") || f.startsWith("partnership.") || f.startsWith("hiring.")),
    5
  );
  const citations = (input.evidenceItemsJson ?? [])
    .map((e) => ({ url: (e.url ?? e.sourceUrl ?? "").trim(), title: e.title ?? null }))
    .filter((e) => e.url)
    .slice(0, 3);

  return {
    summary: input.companySummary?.trim() || null,
    whatTheySell: uniqueHumanized(input.classificationJson?.offerings ?? [], 4),
    industry: uniqueHumanized(input.classificationJson?.industries ?? [], 3),
    size: firstWithPrefix(facts, "size.employee_count_"),
    hq: firstWithPrefix(facts, "geo.hq_country_"),
    geoMarkets: uniqueHumanized(facts.filter((f) => f.startsWith("geo.market_")), 4),
    signals,
    citations,
  };
}
