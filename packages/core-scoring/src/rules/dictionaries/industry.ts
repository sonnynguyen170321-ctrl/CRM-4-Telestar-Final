// SC1 reference dictionary: raw industry -> canonical key (+ parents).
//
// Powers industry allow/deny/sub-industry matching across the 18-ICP corpus.
// Canonicalization is intentionally conservative: an unmapped raw value stays raw
// (returns null) so the scorer can fall back to keyword matching rather than guess.
// Versioned data — bump INDUSTRY_DICTIONARY_VERSION on change. Pure data + helpers.

export const INDUSTRY_KEYS = [
  "SOFTWARE",
  "SAAS",
  "IT_SERVICES",
  "CLOUD_HOSTING",
  "CYBERSECURITY",
  "TELECOM",
  "ISP",
  "FINTECH",
  "BANKING",
  "FINANCE",
  "INSURANCE",
  "HEALTHCARE",
  "RETAIL",
  "ECOMMERCE",
  "FNB",
  "FMCG",
  "MANUFACTURING",
  "LOGISTICS",
  "TRANSPORTATION",
  "HOSPITALITY",
  "MEDIA",
  "ENTERTAINMENT",
  "GAMING",
  "ADVERTISING",
  "MARKETING",
  "EDUCATION",
  "GOVERNMENT",
  "UTILITY",
  "ENERGY",
  "REAL_ESTATE",
  "CRYPTO",
  "CONSTRUCTION",
  "AGRICULTURE",
  "OTHER",
] as const;

export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

type IndustryEntry = {
  canonical: IndustryKey;
  parents?: readonly IndustryKey[];
  // Lowercased substrings that map raw evidence onto this canonical key.
  aliases: readonly string[];
};

export const INDUSTRY_TAXONOMY: readonly IndustryEntry[] = [
  { canonical: "SAAS", parents: ["SOFTWARE"], aliases: ["saas", "software as a service", "b2b saas"] },
  { canonical: "SOFTWARE", aliases: ["software", "software development", "app development", "application development"] },
  { canonical: "IT_SERVICES", aliases: ["it services", "it service", "information technology", "system integrator", "managed it", "msp"] },
  { canonical: "CLOUD_HOSTING", parents: ["IT_SERVICES"], aliases: ["cloud", "hosting", "infrastructure", "data center", "datacenter", "cloud storage"] },
  { canonical: "CYBERSECURITY", parents: ["IT_SERVICES"], aliases: ["cybersecurity", "cyber security", "information security", "network security", "infosec", "security"] },
  { canonical: "TELECOM", aliases: ["telecom", "telecommunication", "ip telephony", "voip"] },
  { canonical: "ISP", parents: ["TELECOM"], aliases: ["isp", "internet service provider", "broadband"] },
  { canonical: "FINTECH", parents: ["FINANCE"], aliases: ["fintech", "financial technology", "payments", "payment"] },
  { canonical: "BANKING", parents: ["FINANCE"], aliases: ["bank", "banking"] },
  { canonical: "INSURANCE", parents: ["FINANCE"], aliases: ["insurance", "insurtech"] },
  { canonical: "FINANCE", aliases: ["finance", "financial services", "financial service", "asset management"] },
  { canonical: "HEALTHCARE", aliases: ["healthcare", "health care", "health & wellness", "medical", "pharma", "hospital", "clinic"] },
  { canonical: "ECOMMERCE", parents: ["RETAIL"], aliases: ["ecommerce", "e-commerce", "online retail", "online store"] },
  { canonical: "RETAIL", aliases: ["retail", "retailer"] },
  { canonical: "FNB", aliases: ["f&b", "food & beverage", "food and beverage", "restaurant", "cafe", "café", "hotels", "qsr"] },
  { canonical: "FMCG", aliases: ["fmcg", "consumer goods", "cpg", "consumer packaged goods"] },
  { canonical: "MANUFACTURING", aliases: ["manufacturing", "manufacturer", "factory", "production", "industrial machinery", "fabricated metals", "plastics", "electronics & high-tech"] },
  { canonical: "LOGISTICS", aliases: ["logistics", "warehousing", "supply chain", "freight"] },
  { canonical: "TRANSPORTATION", aliases: ["transportation", "transport", "mobility", "fleet"] },
  { canonical: "HOSPITALITY", aliases: ["hospitality", "hotel", "resort", "travel", "tourism"] },
  { canonical: "GAMING", parents: ["ENTERTAINMENT"], aliases: ["gaming", "games", "esports", "gamefi"] },
  { canonical: "ENTERTAINMENT", aliases: ["entertainment"] },
  { canonical: "ADVERTISING", parents: ["MARKETING"], aliases: ["advertising", "ad agency", "ads"] },
  { canonical: "MEDIA", aliases: ["media", "publisher", "publishing", "broadcasting", "news"] },
  { canonical: "MARKETING", aliases: ["marketing", "martech", "digital marketing"] },
  { canonical: "EDUCATION", aliases: ["education", "edtech", "university", "school", "courses", "e-learning", "elearning"] },
  { canonical: "GOVERNMENT", aliases: ["government", "public sector", "govtech"] },
  { canonical: "UTILITY", parents: ["ENERGY"], aliases: ["utility", "utilities", "electricity distribution", "power distribution", "water"] },
  { canonical: "ENERGY", aliases: ["energy", "oil & gas", "renewable", "renewables"] },
  { canonical: "REAL_ESTATE", aliases: ["real estate", "property", "proptech"] },
  { canonical: "CRYPTO", aliases: ["crypto", "cryptocurrency", "web3", "defi", "nft", "blockchain", "digital assets", "decentralized finance"] },
  { canonical: "CONSTRUCTION", aliases: ["construction", "engineering & construction"] },
  { canonical: "AGRICULTURE", aliases: ["agriculture", "agritech", "farming"] },
];

export const INDUSTRY_DICTIONARY_VERSION = "industry-v1";

/**
 * Map a raw industry string to a canonical key. Returns null when unmapped
 * (caller should fall back to keyword matching rather than mislabel).
 */
export function canonicalizeIndustry(raw: string): IndustryKey | null {
  const value = String(raw ?? "").trim().toLowerCase();

  if (!value) {
    return null;
  }

  for (const entry of INDUSTRY_TAXONOMY) {
    for (const alias of entry.aliases) {
      if (value.includes(alias)) {
        return entry.canonical;
      }
    }
  }

  return null;
}

/** Canonical key plus its parent keys (for allow/deny matching up the hierarchy). */
export function industryWithParents(key: IndustryKey): IndustryKey[] {
  const entry = INDUSTRY_TAXONOMY.find((item) => item.canonical === key);

  return entry?.parents ? [key, ...entry.parents] : [key];
}
