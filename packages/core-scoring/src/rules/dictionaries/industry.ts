// SC1 reference dictionary: raw industry -> canonical key (+ parents).
//
// Powers industry allow/deny/sub-industry matching across the 18-ICP corpus.
// Canonicalization is intentionally conservative: an unmapped raw value stays raw
// (returns null) so the scorer can fall back to keyword matching rather than guess.
// Versioned data — bump INDUSTRY_DICTIONARY_VERSION on change. Pure data + helpers.
//
// Aliases are checked against every LinkedIn Industry Codes V2 label (and the common V1 labels) in
// __tests__/__fixtures__/linkedin-industries-v2.txt. Sources and decisions:
// docs/scoring/TAXONOMY_2026-10.md. Niches below the sector level live in servedVertical.ts.

import { containsFoldedTerm, foldForMatch } from "./termMatch";

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
  // Lowercase whole words or phrases (accent-folded, plural "s"/"es" accepted) that map raw evidence
  // onto this key. No bare ambiguous nouns: "security" is also guards and patrols, "property" is also
  // intellectual property, "production" is also film, "water" is also bottled drinks.
  aliases: readonly string[];
};

// First entry with a matching alias wins, so a software vendor for banks stays SOFTWARE/SAAS:
// "what the company does" (vendor) is ordered before "who it serves" (sector).
export const INDUSTRY_TAXONOMY: readonly IndustryEntry[] = [
  { canonical: "SAAS", parents: ["SOFTWARE"], aliases: ["saas", "software as a service", "b2b saas", "vertical saas"] },
  { canonical: "CYBERSECURITY", parents: ["IT_SERVICES"], aliases: ["cybersecurity", "cyber security", "information security", "network security", "computer and network security", "computer & network security", "data security", "it security", "cloud security", "endpoint security", "application security", "managed security", "mssp", "infosec", "penetration testing", "an ninh mạng", "an toàn thông tin", "bảo mật thông tin"] },
  { canonical: "SOFTWARE", aliases: ["software", "software development", "app development", "application development", "computer software", "technology, information and internet", "internet company", "social networking platform", "business intelligence platform", "data infrastructure and analytics", "phần mềm"] },
  { canonical: "IT_SERVICES", aliases: ["it services", "it service", "information technology", "it consulting", "it outsourcing", "it solutions", "it system", "system integrator", "systems integrator", "system integration", "managed it", "managed services", "managed service provider", "msp", "technology consulting", "dịch vụ công nghệ thông tin", "công nghệ thông tin", "tích hợp hệ thống"] },
  { canonical: "CLOUD_HOSTING", parents: ["IT_SERVICES"], aliases: ["cloud", "hosting", "web hosting", "data center", "datacenter", "data centre", "colocation", "cloud storage", "cloud infrastructure", "it infrastructure", "iaas", "paas", "điện toán đám mây"] },
  { canonical: "TELECOM", aliases: ["telecom", "telecommunication", "telco", "ip telephony", "voip", "wireless", "mobile network operator", "unified communications", "ucaas", "cpaas", "viễn thông"] },
  { canonical: "ISP", parents: ["TELECOM"], aliases: ["isp", "internet service provider", "internet provider", "broadband", "fiber internet", "fibre broadband", "nhà cung cấp dịch vụ internet"] },
  { canonical: "FINTECH", parents: ["FINANCE"], aliases: ["fintech", "financial technology", "payments", "payment", "payment processing", "payment gateway", "e-wallet", "digital wallet", "regtech", "wealthtech", "lendtech", "buy now pay later", "bnpl", "remittance", "money transfer", "ví điện tử", "trung gian thanh toán", "công nghệ tài chính"] },
  { canonical: "BANKING", parents: ["FINANCE"], aliases: ["bank", "banking", "neobank", "credit union", "savings institution", "credit intermediation", "ngân hàng"] },
  { canonical: "INSURANCE", parents: ["FINANCE"], aliases: ["insurance", "insurtech", "reinsurance", "insurer", "actuarial", "claims adjusting", "bảo hiểm"] },
  { canonical: "CRYPTO", aliases: ["crypto", "cryptocurrency", "web3", "defi", "nft", "blockchain", "digital assets", "decentralized finance", "bitcoin", "tiền mã hóa", "tiền điện tử"] },
  { canonical: "FINANCE", aliases: ["finance", "financial services", "financial service", "asset management", "investment management", "investment advice", "wealth management", "capital markets", "venture capital", "private equity", "hedge fund", "securities", "stock brokerage", "securities brokerage", "online brokerage", "stock exchange", "commodity exchange", "pension fund", "funds and trusts", "trusts and estates", "loan", "lending", "mortgage", "microfinance", "consumer finance", "tài chính", "chứng khoán", "quỹ đầu tư"] },
  { canonical: "HEALTHCARE", aliases: ["healthcare", "health care", "health & wellness", "medical", "pharma", "pharmaceutical", "hospital", "clinic", "clinical", "biotech", "biotechnology", "life sciences", "medtech", "healthtech", "health tech", "digital health", "telehealth", "telemedicine", "dental", "dentist", "physician", "nursing home", "mental health", "home health", "elderly care", "veterinary", "chiropractor", "optometrist", "therapist", "ambulance", "outpatient", "alternative medicine", "y tế", "bệnh viện", "phòng khám", "dược phẩm", "nha khoa", "chăm sóc sức khỏe"] },
  { canonical: "ECOMMERCE", parents: ["RETAIL"], aliases: ["ecommerce", "e-commerce", "online retail", "online store", "online shop", "online marketplace", "internet marketplace", "online and mail order retail", "d2c", "direct-to-consumer", "direct to consumer", "dropshipping", "thương mại điện tử", "sàn thương mại điện tử", "bán hàng trực tuyến"] },
  { canonical: "RETAIL", aliases: ["retail", "retailer", "supermarket", "hypermarket", "grocery", "groceries", "department store", "convenience store", "bán lẻ", "siêu thị", "chuỗi cửa hàng"] },
  { canonical: "FNB", aliases: ["f&b", "food & beverage", "food and beverage", "restaurant", "cafe", "café", "coffee shop", "qsr", "quick service restaurant", "catering", "caterer", "bars, taverns", "nightclub", "brewery", "breweries", "distillery", "distilleries", "winery", "wineries", "food service", "foodservice", "food processing", "nhà hàng", "thực phẩm", "đồ uống", "nước giải khát", "chế biến thực phẩm"] },
  { canonical: "FMCG", aliases: ["fmcg", "consumer goods", "cpg", "consumer packaged goods", "consumer products", "household products", "personal care product", "cosmetics", "tobacco", "hàng tiêu dùng", "hàng tiêu dùng nhanh", "mỹ phẩm"] },
  { canonical: "MANUFACTURING", aliases: ["manufacturing", "manufacturer", "factory", "industrial machinery", "machinery", "fabricated metal", "plastics", "electronics & high-tech", "industrial automation", "semiconductor", "electronics manufacturing", "contract manufacturing", "oem", "shipbuilding", "textile", "garment", "chemical", "packaging", "printing", "steel", "automotive", "auto parts", "aerospace", "sản xuất", "nhà máy", "cơ khí", "dệt may", "may mặc", "linh kiện điện tử"] },
  { canonical: "LOGISTICS", aliases: ["logistics", "logistic", "warehousing", "warehouse", "supply chain", "freight", "freight forwarding", "3pl", "fulfillment", "fulfilment", "courier", "express delivery", "parcel", "last mile", "last-mile", "cold chain", "customs brokerage", "postal service", "shipping", "kho vận", "giao nhận", "chuỗi cung ứng", "chuyển phát nhanh", "kho bãi"] },
  { canonical: "TRANSPORTATION", aliases: ["transportation", "transport", "mobility", "fleet", "airline", "aviation", "rail", "railway", "trucking", "maritime", "taxi", "limousine", "ride-hailing", "ridesharing", "urban transit", "public transit", "bus service", "vận tải", "hàng không"] },
  { canonical: "HOSPITALITY", aliases: ["hospitality", "hotel", "hotels and motels", "motel", "resort", "travel", "tourism", "accommodation", "lodging", "hostel", "homestay", "bed-and-breakfast", "bed and breakfast", "travel agency", "tour operator", "khách sạn", "du lịch", "lữ hành", "khu nghỉ dưỡng"] },
  { canonical: "GAMING", parents: ["ENTERTAINMENT"], aliases: ["gaming", "games", "video game", "game development", "game studio", "esports", "e-sports", "gamefi"] },
  { canonical: "ENTERTAINMENT", aliases: ["entertainment", "movies", "film", "music", "sound recording", "performing arts", "spectator sports", "sports teams", "amusement park", "theme park", "museum", "theater", "theatre", "cinema", "recreational facilities", "golf courses", "country clubs", "wellness and fitness", "fitness", "giải trí"] },
  { canonical: "ADVERTISING", parents: ["MARKETING"], aliases: ["advertising", "ad agency", "ads", "adtech", "ad tech", "programmatic", "media buying", "quảng cáo"] },
  { canonical: "MEDIA", aliases: ["media", "publisher", "publishing", "broadcasting", "broadcast", "news", "newspaper", "radio", "television", "streaming", "podcast", "magazine", "journalism", "blog", "animation", "post-production", "cable and satellite", "truyền thông", "báo chí"] },
  { canonical: "MARKETING", aliases: ["marketing", "martech", "digital marketing", "marketing agency", "public relations", "pr agency", "seo", "market research", "branding agency", "creative agency", "growth agency", "lead generation", "demand generation", "influencer marketing", "tiếp thị"] },
  { canonical: "EDUCATION", aliases: ["education", "edtech", "university", "universities", "college", "school", "schools", "academy", "online courses", "e-learning", "elearning", "professional training", "vocational training", "corporate training", "flight training", "tutoring", "language school", "k-12", "higher education", "giáo dục", "đào tạo", "trường học", "đại học", "trung tâm anh ngữ"] },
  { canonical: "GOVERNMENT", aliases: ["government", "public sector", "govtech", "public administration", "public policy", "public safety", "law enforcement", "administration of justice", "courts of law", "correctional", "fire protection", "legislative", "armed forces", "military", "municipal", "ministry", "chính phủ", "cơ quan nhà nước", "nhà nước"] },
  { canonical: "UTILITY", parents: ["ENERGY"], aliases: ["utility", "utilities", "electric utility", "electricity distribution", "power distribution", "electric power", "power generation", "water utility", "water supply", "wastewater", "waste", "waste management", "natural gas distribution", "điện lực", "cấp nước"] },
  { canonical: "ENERGY", aliases: ["energy", "oil & gas", "oil and gas", "oil, gas", "petroleum", "renewable", "renewables", "solar", "wind energy", "wind power", "clean energy", "cleantech", "hydrogen", "nuclear", "coal", "mining", "natural gas", "oil extraction", "năng lượng", "dầu khí", "điện mặt trời"] },
  { canonical: "REAL_ESTATE", aliases: ["real estate", "realty", "realtor", "properties", "property management", "property development", "property developer", "property investment", "proptech", "reit", "coworking", "co-working", "bất động sản"] },
  { canonical: "CONSTRUCTION", aliases: ["construction", "engineering & construction", "civil engineering", "contractor", "architecture and planning", "xây dựng", "nhà thầu", "xây lắp"] },
  { canonical: "AGRICULTURE", aliases: ["agriculture", "agritech", "agtech", "farming", "farm", "ranching", "forestry", "fishery", "fisheries", "aquaculture", "horticulture", "livestock", "plantation", "agribusiness", "nông nghiệp", "nông sản", "thủy sản", "chăn nuôi"] },
];

// v2 (2026-10-10): whole-word matching (v1's substring match sent "Hospitality" to HEALTHCARE,
// "Urban Transit Services" to IT_SERVICES, "Alternative Dispute Resolution" to ISP), LinkedIn V2
// coverage, Vietnamese aliases, ambiguous bare nouns removed.
export const INDUSTRY_DICTIONARY_VERSION = "industry-v2";

// Aliases folded once, at load.
const COMPILED = INDUSTRY_TAXONOMY.flatMap((entry) =>
  entry.aliases.map((alias) => ({ canonical: entry.canonical, folded: foldForMatch(alias) }))
);

/**
 * Map a raw industry string to a canonical key. Returns null when unmapped
 * (caller should fall back to keyword matching rather than mislabel).
 */
export function canonicalizeIndustry(raw: string): IndustryKey | null {
  const value = foldForMatch(String(raw ?? ""));

  if (!value) {
    return null;
  }

  for (const { canonical, folded } of COMPILED) {
    if (containsFoldedTerm(value, folded, { plural: true })) {
      return canonical;
    }
  }

  return null;
}

/** Canonical key plus its parent keys (for allow/deny matching up the hierarchy). */
export function industryWithParents(key: IndustryKey): IndustryKey[] {
  const entry = INDUSTRY_TAXONOMY.find((item) => item.canonical === key);

  return entry?.parents ? [key, ...entry.parents] : [key];
}
