/**
 * Neutral fact extraction for company enrichment (S-ENRICH-B).
 *
 * Extractors emit controlled neutral tokens with evidence pointers only. They
 * never emit qualification, fitScore, confidenceScore, final status, or any
 * ICP-specific verdict. Unknown content emits nothing; absence is handled by
 * each ICP's missing-evidence policy downstream.
 */

export const NEUTRAL_FACT_TOKENS = [
  "offering.saas",
  "offering.cybersecurity",
  "offering.erp",
  "offering.cloud_infrastructure",
  "offering.consulting",
  "business_model.b2b",
  "business_model.b2c",
  "business_model.marketplace",
  "industry.banking",
  "industry.manufacturing",
  "industry.retail",
  "industry.telecom",
  "maturity.has_pricing_page",
  "maturity.hiring",
  "maturity.has_case_studies",
  "growth.funding",
  "growth.expansion",
  "news.recent",
  "proof.case_study",
  "proof.customer_logo",
  "risk.service_product_ambiguity",
] as const;

export type StaticNeutralFactToken = (typeof NEUTRAL_FACT_TOKENS)[number];

/**
 * Dynamic tokens follow these shapes:
 * - geo.hq_country_<x>, geo.office_country_<x>, geo.factory_country_<x>, geo.market_<x>
 * - size.employee_count_<n>, size.range_<band> (band derived from the count, never a keyword)
 * - market.segment_<smb|mid_market> (target market — who they serve, NOT company size)
 * - revenue.usd_<amount>
 * - location.count_<n>, location.multi_location
 * where dynamic values are normalized and only emitted from explicit text.
 */
export type NeutralFactToken = StaticNeutralFactToken | string;

export type EvidenceItem = {
  token: NeutralFactToken;
  evidenceText: string;
  sourceUrl: string;
};

export type FetchedPage = {
  url: string;
  path: string;
  text: string;
};

/**
 * Known geographies for geo.* token extraction. Keys are the canonical token
 * suffix; values are the regex alternation patterns matched against page text.
 */
const KNOWN_GEOGRAPHIES: Array<{ slug: string; pattern: string }> = [
  { slug: "singapore", pattern: "singapore" },
  { slug: "vietnam", pattern: "vietnam" },
  { slug: "thailand", pattern: "thailand" },
  { slug: "malaysia", pattern: "malaysia" },
  { slug: "indonesia", pattern: "indonesia" },
  { slug: "philippines", pattern: "philippines" },
  { slug: "india", pattern: "india" },
  { slug: "china", pattern: "china" },
  { slug: "japan", pattern: "japan" },
  { slug: "south_korea", pattern: "south korea" },
  { slug: "australia", pattern: "australia" },
  { slug: "united_states", pattern: "united states|u\\.s\\.a?\\.?|usa" },
  { slug: "united_kingdom", pattern: "united kingdom|u\\.k\\.|uk\\b" },
  { slug: "hong_kong", pattern: "hong kong" },
];

const HQ_CONTEXT_PATTERN =
  /(headquartered in|headquarters (?:is |are )?(?:located )?in|head office (?:is |in)|based in)\s+([a-z .'-]+)/i;

const FACTORY_CONTEXT_PATTERN =
  /(factory|manufacturing (?:plant|facility)|production (?:plant|facility)|plant)\s+(?:is\s+)?(?:located\s+)?in\s+([a-z .'-]+)/i;

const OFFICE_CONTEXT_PATTERN =
  /(offices?|branches?|locations?)\s+(?:are\s+)?(?:located\s+)?(?:in|across)\s+([a-z .,'-]+)/i;

const MARKET_CONTEXT_PATTERN =
  /(serving customers in|operations in|presence in|offices? in|markets? (?:in|across))\s+([a-z .,'-]+)/i;

type StaticRule = {
  token: StaticNeutralFactToken;
  pattern: RegExp;
};

const STATIC_RULES: StaticRule[] = [
  {
    token: "offering.saas",
    pattern: /\b(saas|software as a service|software-as-a-service)\b/i,
  },
  {
    token: "offering.cybersecurity",
    pattern:
      /\b(cyber\s?security|threat (?:detection|intelligence|protection)|managed security|soc\b|siem|ddos protection|network protection)\b/i,
  },
  {
    token: "offering.erp",
    pattern: /\b(erp|enterprise resource planning)\b/i,
  },
  {
    token: "offering.cloud_infrastructure",
    pattern:
      /\b(cloud infrastructure|cloud computing|cloud migration|infrastructure as a service|iaas|kubernetes|multi-cloud)\b/i,
  },
  {
    token: "offering.consulting",
    pattern: /\b(consulting|professional services|advisory services)\b/i,
  },
  {
    token: "business_model.b2b",
    pattern: /\b(b2b|business[- ]to[- ]business)\b/i,
  },
  {
    token: "business_model.b2c",
    pattern: /\b(b2c|business[- ]to[- ]consumer)\b/i,
  },
  {
    token: "business_model.marketplace",
    pattern: /\bmarketplace\b/i,
  },
  {
    token: "industry.banking",
    pattern: /\b(banking|bank|financial institutions?)\b/i,
  },
  {
    token: "industry.manufacturing",
    pattern: /\b(manufactur(?:ing|er)|factory|production line)\b/i,
  },
  {
    token: "industry.retail",
    pattern: /\b(retail|retailer|e-commerce|ecommerce)\b/i,
  },
  {
    token: "industry.telecom",
    pattern: /\b(telecom(?:munications)?|mobile network operator|isp)\b/i,
  },
  {
    // Genuine hiring INTENT only. Dropped "join our team" / "career opportunities" — those are
    // footer/nav boilerplate on nearly every site and produced false hiring/expansion signals.
    token: "maturity.hiring",
    pattern:
      /\b(we(?:'| a)?re hiring|now hiring|hiring for\b|open (?:positions|roles)|job openings?|[1-9]\d*\s+open (?:positions|roles|jobs))\b/i,
  },
  {
    token: "maturity.has_case_studies",
    pattern: /\b(case stud(?:y|ies)|success stor(?:y|ies)|customer stor(?:y|ies))\b/i,
  },
  {
    token: "growth.funding",
    pattern:
      /\b(raised \$|funding round|series [a-d] round|seed funding|venture capital investment|secured \$)\b/i,
  },
  {
    token: "growth.expansion",
    pattern:
      /\b(expand(?:ing|s|ed)? (?:into|to)|new office|opening (?:a |an )?office|expansion into)\b/i,
  },
  {
    token: "proof.case_study",
    pattern: /\bcase stud(?:y|ies)\b/i,
  },
  {
    token: "proof.customer_logo",
    pattern: /\b(trusted by|our clients include|customers include|used by leading)\b/i,
  },
];

const RISK_PRODUCT_PATTERN = /\b(platform|software|product)\b/i;
const RISK_SERVICE_PATTERN = /\b(consulting|managed services|outsourcing|agency)\b/i;

const PRICING_PATH_PATTERN = /^\/(pricing|plans)(\/|$)/i;
const CAREERS_PATH_PATTERN = /^\/(careers|jobs)(\/|$)/i;
const NEWS_PATH_PATTERN = /^\/(news|press)(\/|$)/i;

const EMPLOYEE_COUNT_PATTERNS = [
  /\b(?:team of|staff of|workforce of|employee base of)\s+([1-9][\d,]{0,8})\b/i,
  /\b([1-9][\d,]{0,8})\s*(?:\+?\s*)?(?:employees|staff|team members|people worldwide|full-time employees|ftes)\b/i,
  /\b(?:employs|employing)\s+([1-9][\d,]{0,8})\s*(?:\+?\s*)?(?:people|employees|staff)?\b/i,
];

// Company size BAND is derived from a real headcount, never from a keyword. A phrase
// like "small businesses" almost always describes who the company SELLS TO (target
// market), not the company itself — so a 354-person firm that serves SMBs must not be
// classified "small". Bands are scoring-compatible (SMALL/MEDIUM/MID_MARKET/...).
function classifySizeBand(count: number): string {
  if (count <= 50) return "SMALL";
  if (count <= 200) return "MEDIUM";
  if (count <= 1000) return "MID_MARKET";
  if (count <= 5000) return "ENTERPRISE";
  return "LARGE_ENTERPRISE";
}

// Target-market segment (who they serve) — captured separately from company size so
// "serves small businesses" can never masquerade as the company's own headcount band.
const TARGET_MARKET_PATTERNS: Array<{ token: string; pattern: RegExp }> = [
  { token: "market.segment_smb", pattern: /\b(SMEs?|SMBs?|small businesses?|small[- ]and[- ]medium(?:[- ]sized)?(?:\s+(?:businesses|companies|enterprises))?)\b/i },
  { token: "market.segment_mid_market", pattern: /\b(mid-market|mid market|midmarket)\b/i },
];

const REVENUE_PATTERNS = [
  /\b(?:annual\s+)?revenue(?:\s+(?:of|over|above|exceeding|around|approximately))?\s+(?:US\$|USD\s*)?(\$?\s*[1-9][\d,.]*)\s*(billion|million|bn|m|k)?\b/i,
  /\b(?:US\$|USD\s*)?(\$?\s*[1-9][\d,.]*)\s*(billion|million|bn|m|k)?\s+(?:in\s+)?(?:annual\s+)?revenue\b/i,
];

const LOCATION_COUNT_PATTERNS = [
  /\b([2-9]\d{0,3})\s+(?:offices|branches|locations|sites|facilities)\b/i,
  /\b(?:operates|has|runs)\s+([2-9]\d{0,3})\s+(?:offices|branches|locations|sites|facilities)\b/i,
];

const MULTI_LOCATION_PATTERN =
  /\b(multiple|several|many)\s+(?:offices|branches|locations|sites|facilities)\b/i;

/**
 * Extracts neutral fact tokens with evidence pointers from fetched page text.
 * Output never includes qualification, fitScore, confidenceScore, or status.
 */
export function extractNeutralFacts(pages: FetchedPage[]): EvidenceItem[] {
  const evidenceItems: EvidenceItem[] = [];
  const seenTokens = new Set<string>();

  const emit = (token: NeutralFactToken, evidenceText: string, sourceUrl: string) => {
    const key = `${token}::${sourceUrl}`;

    if (seenTokens.has(key)) {
      return;
    }

    seenTokens.add(key);
    evidenceItems.push({ token, evidenceText: snippet(evidenceText), sourceUrl });
  };

  for (const page of pages) {
    if (!page.text) {
      continue;
    }

    for (const rule of STATIC_RULES) {
      const match = page.text.match(rule.pattern);

      if (match) {
        // Evidence = the sentence around the match, not the bare keyword, so it reads as real
        // context an SDR can verify (and a one-word nav/footer hit yields a short, honest snippet).
        emit(rule.token, sentenceAround(page.text, match.index ?? 0, match[0]), page.url);
      }
    }

    extractGeoFacts(page, emit);
    extractSizeFacts(page, emit);
    extractRevenueFacts(page, emit);
    extractLocationFacts(page, emit);

    if (
      PRICING_PATH_PATTERN.test(page.path) ||
      /\b(pricing|plans?)\b/i.test(page.text)
    ) {
      const match = page.text.match(/\b(pricing|plans?)\b/i);
      emit("maturity.has_pricing_page", match?.[0] ?? "pricing", page.url);
    }

    if (NEWS_PATH_PATTERN.test(page.path) && page.text.trim().length > 0) {
      emit("news.recent", snippet(page.text), page.url);
    }

    // A careers page only implies hiring when it shows REAL role evidence — an open-role list /
    // apply CTA — not merely because the page (or a soft-404 careers URL) exists. This kills the
    // "hiring/expansion from an empty /careers page" false signal.
    if (CAREERS_PATH_PATTERN.test(page.path)) {
      const roleMatch = page.text.match(
        /\b(open (?:positions|roles)|job openings?|apply (?:now|today)|view (?:all )?(?:jobs|roles|openings)|[1-9]\d*\s+(?:open )?(?:positions|roles|jobs))\b/i
      );
      if (roleMatch) {
        emit("maturity.hiring", sentenceAround(page.text, roleMatch.index ?? 0, roleMatch[0]), page.url);
      }
    }

    if (RISK_PRODUCT_PATTERN.test(page.text) && RISK_SERVICE_PATTERN.test(page.text)) {
      const productMatch = page.text.match(RISK_PRODUCT_PATTERN);
      const serviceMatch = page.text.match(RISK_SERVICE_PATTERN);
      emit(
        "risk.service_product_ambiguity",
        `${productMatch?.[0] ?? ""} / ${serviceMatch?.[0] ?? ""}`.trim(),
        page.url
      );
    }
  }

  return evidenceItems;
}

function extractGeoFacts(
  page: FetchedPage,
  emit: (token: NeutralFactToken, evidenceText: string, sourceUrl: string) => void
) {
  for (const geography of KNOWN_GEOGRAPHIES) {
    const countryRegex = new RegExp(`\\b(${geography.pattern})\\b`, "i");

    if (!countryRegex.test(page.text)) {
      continue;
    }

    const hqMatch = page.text.match(HQ_CONTEXT_PATTERN);
    if (hqMatch && countryRegex.test(hqMatch[2] ?? "")) {
      emit(`geo.hq_country_${geography.slug}`, hqMatch[0], page.url);
    }

    const factoryMatch = page.text.match(FACTORY_CONTEXT_PATTERN);
    if (factoryMatch && countryRegex.test(factoryMatch[2] ?? "")) {
      emit(`geo.factory_country_${geography.slug}`, factoryMatch[0], page.url);
    }

    const officeMatch = page.text.match(OFFICE_CONTEXT_PATTERN);
    if (officeMatch && countryRegex.test(officeMatch[2] ?? "")) {
      emit(`geo.office_country_${geography.slug}`, officeMatch[0], page.url);
    }

    const marketMatch = page.text.match(MARKET_CONTEXT_PATTERN);
    if (marketMatch && countryRegex.test(marketMatch[2] ?? "")) {
      emit(`geo.market_${geography.slug}`, marketMatch[0], page.url);
    }
  }
}

function extractSizeFacts(
  page: FetchedPage,
  emit: (token: NeutralFactToken, evidenceText: string, sourceUrl: string) => void
) {
  // Company size — ONLY from an explicit headcount. The band is derived from the
  // number so it can never contradict the count.
  for (const pattern of EMPLOYEE_COUNT_PATTERNS) {
    const match = page.text.match(pattern);
    const count = parseInteger(match?.[1]);
    if (count !== null) {
      const evidence = match?.[0] ?? `${count} employees`;
      emit(`size.employee_count_${count}`, evidence, page.url);
      emit(`size.range_${classifySizeBand(count)}`, evidence, page.url);
      break;
    }
  }

  // Target market — who they serve. Separate concept from company size.
  for (const rule of TARGET_MARKET_PATTERNS) {
    const match = page.text.match(rule.pattern);
    if (match) {
      emit(rule.token, match[0], page.url);
    }
  }
}

function extractRevenueFacts(
  page: FetchedPage,
  emit: (token: NeutralFactToken, evidenceText: string, sourceUrl: string) => void
) {
  for (const pattern of REVENUE_PATTERNS) {
    const match = page.text.match(pattern);
    const amount = parseCurrencyAmount(match?.[1], match?.[2]);
    if (amount !== null) {
      emit(`revenue.usd_${amount}`, match?.[0] ?? `$${amount} revenue`, page.url);
      break;
    }
  }
}

function extractLocationFacts(
  page: FetchedPage,
  emit: (token: NeutralFactToken, evidenceText: string, sourceUrl: string) => void
) {
  for (const pattern of LOCATION_COUNT_PATTERNS) {
    const match = page.text.match(pattern);
    const count = parseInteger(match?.[1]);
    if (count !== null && count > 1) {
      emit(`location.count_${count}`, match?.[0] ?? `${count} locations`, page.url);
      break;
    }
  }

  const multiLocationMatch = page.text.match(MULTI_LOCATION_PATTERN);
  if (multiLocationMatch) {
    emit("location.multi_location", multiLocationMatch[0], page.url);
  }
}

function parseInteger(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const value = Number(raw.replace(/,/g, ""));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseCurrencyAmount(
  rawAmount: string | undefined,
  rawUnit: string | undefined
): number | null {
  if (!rawAmount) {
    return null;
  }

  const amount = Number(rawAmount.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = String(rawUnit ?? "").trim().toLowerCase();
  const multiplier =
    unit === "billion" || unit === "bn"
      ? 1_000_000_000
      : unit === "million" || unit === "m"
        ? 1_000_000
        : unit === "k"
          ? 1_000
          : 1;

  return Math.round(amount * multiplier);
}

// Return the sentence containing the match index so evidence is real context, not a bare
// keyword. Falls back to the keyword when no sentence boundary is nearby.
function sentenceAround(text: string, index: number, fallback = ""): string {
  if (!text) return snippet(fallback);
  const boundary = (chars: string[], from: number, dir: "back" | "fwd"): number => {
    const positions = chars
      .map((ch) => (dir === "back" ? text.lastIndexOf(ch, from) : indexFrom(text, ch, from)))
      .filter((pos) => pos >= 0);
    if (positions.length === 0) return dir === "back" ? -1 : text.length;
    return dir === "back" ? Math.max(...positions) : Math.min(...positions);
  };
  const from = boundary([".", "!", "?", "\n"], Math.max(0, index - 1), "back") + 1;
  const end = Math.min(boundary([".", "!", "?", "\n"], index, "fwd") + 1, index + 220);
  const sentence = text.slice(Math.max(0, from), end).trim();
  return snippet(sentence.length >= 2 ? sentence : fallback);
}

function indexFrom(text: string, ch: string, from: number): number {
  const pos = text.indexOf(ch, from);
  return pos;
}

function snippet(text: string, maxLength = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

export function uniqueFactTokens(evidenceItems: EvidenceItem[]): string[] {
  return Array.from(new Set(evidenceItems.map((item) => item.token))).sort();
}
