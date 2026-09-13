// W5 (#6): the SERVED-VERTICAL dimension — the second axis of a company's industry identity, and the
// source of the hierarchical industry FILTER.
//
// The existing INDUSTRY_TAXONOMY (industry.ts) answers "what does the company DO" (SaaS, Manufacturing,
// IT Services…). This answers "who/what does it serve or make" as a broad, deep, multi-sector tree:
//   sector (Industrial) → vertical (Textiles) → leaf (Wool)
//   sector (Finance)    → vertical (Payments)
// A company = (category, [served verticals]); rendered "Category · Vertical" everywhere, and the tree
// powers a hierarchical filter facet on the companies + leads sidebars.
//
// Pure data + pure classifier. No I/O, no AI — deterministic, unit-tested. Comprehensive by design
// (15 top-level sectors) rather than tuned to any one example. Bump SERVED_VERTICAL_VERSION on change.

// v3: word-boundary (Unicode) alias matching + Vietnamese aliases across all sectors.
export const SERVED_VERTICAL_VERSION = "served-vertical-v3";

export type ServedVerticalEntry = {
  key: string;
  label: string;
  /** Parent vertical key for the hierarchy (sector → vertical → leaf). Top-level sectors omit it. */
  parent?: string;
  /** Lowercased substrings that map raw evidence onto this vertical. Kept tight to avoid false hits. */
  aliases: readonly string[];
};

// Ordered most-specific-first within each branch so a leaf ("wool") is preferred over its parent
// ("textiles") over its sector ("industrial"). The classifier de-dupes to the most specific hit.
export const SERVED_VERTICAL_TAXONOMY: readonly ServedVerticalEntry[] = [
  // ═══ TECHNOLOGY ══════════════════════════════════════════════════════════════════════════════
  { key: "TECH_AI", label: "Data & AI", parent: "TECHNOLOGY", aliases: ["artificial intelligence", "machine learning", "ml platform", "data science", "data analytics", "big data", "llm", "generative ai", "computer vision", "nlp", "trí tuệ nhân tạo", "học máy", "phân tích dữ liệu"] },
  { key: "TECH_CYBER", label: "Cybersecurity", parent: "TECHNOLOGY", aliases: ["cybersecurity", "cyber security", "information security", "infosec", "network security", "endpoint security", "iam", "zero trust", "an ninh mạng", "an toàn thông tin", "bảo mật thông tin"] },
  { key: "TECH_CLOUD", label: "Cloud & Infrastructure", parent: "TECHNOLOGY", aliases: ["cloud infrastructure", "cloud platform", "hosting", "data center", "datacenter", "kubernetes", "devops", "serverless", "iaas", "paas"] },
  { key: "TECH_DEVTOOLS", label: "Developer Tools", parent: "TECHNOLOGY", aliases: ["developer tools", "devtools", "api platform", "sdk", "ci/cd", "observability", "low-code", "no-code"] },
  { key: "TECH_SAAS", label: "SaaS / Software", parent: "TECHNOLOGY", aliases: ["saas", "software as a service", "b2b software", "enterprise software", "application software", "software platform"] },
  { key: "TECH_HARDWARE", label: "Hardware & Semiconductors", parent: "TECHNOLOGY", aliases: ["semiconductor", "chip", "hardware", "iot device", "robotics", "electronics component"] },
  { key: "TECH_IT_SERVICES", label: "IT Services & MSP", parent: "TECHNOLOGY", aliases: ["it services", "managed services", "msp", "system integrator", "it consulting", "outsourced it", "dịch vụ công nghệ thông tin", "tích hợp hệ thống", "giải pháp công nghệ"] },
  { key: "TECH_TELECOM", label: "Telecom & Networking", parent: "TECHNOLOGY", aliases: ["telecom", "telecommunication", "networking", "isp", "broadband", "5g", "voip", "carrier", "viễn thông", "mạng lưới"] },
  { key: "TECHNOLOGY", label: "Technology", aliases: ["technology", "tech company", "software", "internet", "information technology", "công nghệ", "công nghệ thông tin", "phần mềm"] },

  // ═══ FINANCE ═════════════════════════════════════════════════════════════════════════════════
  { key: "FIN_PAYMENTS", label: "Payments", parent: "FINANCE", aliases: ["payments", "payment processing", "payment gateway", "card processing", "acquiring", "pos payment", "thanh toán", "cổng thanh toán", "ví điện tử"] },
  { key: "FIN_LENDING", label: "Lending & Credit", parent: "FINANCE", aliases: ["lending", "loans", "credit scoring", "bnpl", "buy now pay later", "mortgage", "consumer credit", "cho vay", "tín dụng", "mua trước trả sau"] },
  { key: "FIN_WEALTH", label: "Wealth & Asset Mgmt", parent: "FINANCE", aliases: ["wealth management", "asset management", "wealthtech", "investment management", "brokerage", "robo-advisor"] },
  { key: "FIN_INSURANCE", label: "Insurance", parent: "FINANCE", aliases: ["insurance", "insurtech", "underwriting", "reinsurance", "claims management", "bảo hiểm"] },
  { key: "FIN_BANKING", label: "Banking", parent: "FINANCE", aliases: ["bank", "banking", "neobank", "core banking", "retail banking", "ngân hàng", "ngân hàng số"] },
  { key: "FIN_CAPITAL_MARKETS", label: "Capital Markets", parent: "FINANCE", aliases: ["capital markets", "trading platform", "exchange", "securities", "hedge fund", "private equity", "venture capital"] },
  { key: "FIN_CRYPTO", label: "Crypto & Web3", parent: "FINANCE", aliases: ["crypto", "cryptocurrency", "web3", "defi", "blockchain", "nft", "digital assets", "stablecoin"] },
  { key: "FIN_ACCOUNTING", label: "Accounting & Tax", parent: "FINANCE", aliases: ["accounting", "bookkeeping", "tax software", "invoicing", "expense management", "erp finance"] },
  { key: "FINANCE", label: "Financial Services", aliases: ["finance", "financial services", "fintech", "financial technology", "tài chính", "dịch vụ tài chính", "công nghệ tài chính"] },

  // ═══ HEALTHCARE & LIFE SCIENCES ══════════════════════════════════════════════════════════════
  { key: "HEALTH_PHARMA", label: "Pharma & Biotech", parent: "HEALTHCARE", aliases: ["pharma", "pharmaceutical", "biotech", "biotechnology", "drug discovery", "clinical trials", "genomics", "dược phẩm", "công nghệ sinh học"] },
  { key: "HEALTH_DEVICES", label: "Medical Devices", parent: "HEALTHCARE", aliases: ["medical device", "medtech", "surgical equipment", "implants", "wearable health"] },
  { key: "HEALTH_DIAGNOSTICS", label: "Diagnostics & Labs", parent: "HEALTHCARE", aliases: ["diagnostics", "laboratory", "lab testing", "pathology", "imaging"] },
  { key: "HEALTH_PROVIDERS", label: "Providers & Clinics", parent: "HEALTHCARE", aliases: ["hospital", "clinic", "provider network", "telehealth", "telemedicine", "home care", "dental", "bệnh viện", "phòng khám", "nha khoa"] },
  { key: "HEALTH_DIGITAL", label: "Digital Health", parent: "HEALTHCARE", aliases: ["digital health", "healthtech", "health app", "mental health platform", "patient engagement"] },
  { key: "HEALTH_PAYERS", label: "Health Payers", parent: "HEALTHCARE", aliases: ["health insurance", "payer", "health plan", "benefits administration"] },
  { key: "HEALTHCARE", label: "Healthcare & Life Sciences", aliases: ["healthcare", "health care", "life sciences", "medical", "y tế", "chăm sóc sức khỏe"] },

  // ═══ INDUSTRIAL & MANUFACTURING ══════════════════════════════════════════════════════════════
  { key: "IND_WOOL", label: "Wool", parent: "IND_TEXTILES", aliases: ["wool", "woollen", "woolen", "merino", "worsted", "cashmere"] },
  { key: "IND_COTTON", label: "Cotton", parent: "IND_TEXTILES", aliases: ["cotton", "denim"] },
  { key: "IND_SYNTHETIC_FIBER", label: "Synthetic Fiber", parent: "IND_TEXTILES", aliases: ["polyester", "nylon", "synthetic fiber", "synthetic fibre", "spandex", "viscose"] },
  { key: "IND_TEXTILES", label: "Textiles & Apparel Mfg", parent: "INDUSTRIAL", aliases: ["textile", "textiles", "fabric", "yarn", "weaving", "knitting", "garment manufacturing", "fibre", "fiber", "dệt may", "sợi", "vải"] },
  { key: "IND_RUBBER", label: "Rubber & Elastic", parent: "IND_MATERIALS", aliases: ["rubber", "elastic", "elastomer", "latex", "vulcanized", "tire"] },
  { key: "IND_PLASTICS", label: "Plastics & Polymers", parent: "IND_MATERIALS", aliases: ["plastic", "plastics", "polymer", "polymers", "injection molding", "injection moulding", "extrusion"] },
  { key: "IND_METALS", label: "Metals & Steel", parent: "IND_MATERIALS", aliases: ["steel", "aluminium", "aluminum", "metal fabrication", "fabricated metal", "foundry", "casting", "forging"] },
  { key: "IND_CHEMICALS", label: "Chemicals", parent: "IND_MATERIALS", aliases: ["chemical", "chemicals", "specialty chemicals", "coatings", "adhesives", "petrochemical"] },
  { key: "IND_GLASS_CERAMICS", label: "Glass & Ceramics", parent: "IND_MATERIALS", aliases: ["glass", "ceramic", "ceramics", "porcelain"] },
  { key: "IND_MATERIALS", label: "Materials", parent: "INDUSTRIAL", aliases: ["materials", "raw materials", "industrial materials"] },
  { key: "IND_MACHINERY", label: "Machinery & Equipment", parent: "INDUSTRIAL", aliases: ["machinery", "industrial equipment", "heavy equipment", "industrial machinery", "cnc", "capital goods", "máy móc", "thiết bị công nghiệp", "dây chuyền sản xuất"] },
  { key: "IND_ELECTRONICS", label: "Electronics Mfg", parent: "INDUSTRIAL", aliases: ["electronics manufacturing", "pcb", "contract manufacturing", "high-tech manufacturing", "assembly"] },
  { key: "IND_AUTOMOTIVE", label: "Automotive & Parts", parent: "INDUSTRIAL", aliases: ["automotive", "auto parts", "vehicle manufacturing", "ev", "electric vehicle", "auto components"] },
  { key: "IND_AEROSPACE", label: "Aerospace & Defense Mfg", parent: "INDUSTRIAL", aliases: ["aerospace", "aviation manufacturing", "defense manufacturing", "aircraft parts"] },
  { key: "IND_PACKAGING", label: "Packaging", parent: "INDUSTRIAL", aliases: ["packaging", "corrugated", "flexible packaging", "labels", "containers", "bao bì", "đóng gói"] },
  { key: "INDUSTRIAL", label: "Industrial & Manufacturing", aliases: ["manufacturing", "manufacturer", "factory", "industrial", "production", "oem", "sản xuất", "nhà máy", "chế tạo", "cơ khí", "khu công nghiệp"] },

  // ═══ CONSUMER & RETAIL ═══════════════════════════════════════════════════════════════════════
  { key: "RET_FASHION", label: "Fashion & Apparel", parent: "CONSUMER", aliases: ["fashion", "apparel", "clothing brand", "footwear", "luxury goods", "accessories", "thời trang", "may mặc", "giày dép"] },
  { key: "RET_BEAUTY", label: "Beauty & Personal Care", parent: "CONSUMER", aliases: ["beauty", "cosmetics", "personal care", "skincare", "fragrance", "mỹ phẩm", "chăm sóc cá nhân", "hóa mỹ phẩm"] },
  { key: "RET_GROCERY", label: "Grocery & Food Retail", parent: "CONSUMER", aliases: ["grocery", "supermarket", "food retail", "convenience store", "siêu thị", "cửa hàng tiện lợi", "bách hóa"] },
  { key: "RET_FMCG", label: "FMCG / CPG", parent: "CONSUMER", aliases: ["fmcg", "cpg", "consumer packaged goods", "consumer goods", "household goods", "hàng tiêu dùng", "tiêu dùng nhanh"] },
  { key: "RET_HOME", label: "Home & Furniture", parent: "CONSUMER", aliases: ["furniture", "home goods", "home decor", "appliances", "homeware", "nội thất", "đồ gia dụng"] },
  { key: "RET_ECOMMERCE", label: "Ecommerce & Marketplaces", parent: "CONSUMER", aliases: ["ecommerce", "e-commerce", "online retail", "marketplace", "d2c", "direct to consumer", "dropshipping", "thương mại điện tử", "sàn thương mại điện tử", "bán hàng trực tuyến"] },
  { key: "CONSUMER", label: "Consumer & Retail", aliases: ["retail", "retailer", "consumer brand", "commerce", "bán lẻ", "phân phối", "nhà phân phối", "bán buôn", "bán sỉ"] },

  // ═══ FOOD & AGRICULTURE ══════════════════════════════════════════════════════════════════════
  { key: "AGRI_AGRITECH", label: "Agritech", parent: "AGRICULTURE", aliases: ["agritech", "agtech", "precision agriculture", "farm management", "nông nghiệp công nghệ cao"] },
  { key: "AGRI_FARMING", label: "Farming & Crops", parent: "AGRICULTURE", aliases: ["farming", "crop", "horticulture", "plantation", "agribusiness", "trang trại", "trồng trọt", "hạt điều", "hồ tiêu", "lúa gạo", "cà phê nhân"] },
  { key: "AGRI_LIVESTOCK", label: "Livestock & Dairy", parent: "AGRICULTURE", aliases: ["livestock", "dairy", "poultry", "aquaculture", "fishery", "chăn nuôi", "sữa", "sữa tươi", "sữa bột", "thủy sản", "nuôi trồng thủy sản"] },
  { key: "AGRI_FNB", label: "Food & Beverage", parent: "AGRICULTURE", aliases: ["food & beverage", "food and beverage", "f&b", "beverage", "packaged food", "food processing", "thực phẩm", "đồ uống", "nước giải khát", "nước ngọt", "bia", "rượu", "bánh kẹo", "mì ăn liền", "cà phê", "chế biến thực phẩm", "nước mắm"] },
  { key: "AGRI_RESTAURANTS", label: "Restaurants & QSR", parent: "AGRICULTURE", aliases: ["restaurant", "qsr", "quick service", "cafe", "catering", "cloud kitchen", "nhà hàng", "quán cà phê", "chuỗi nhà hàng"] },
  { key: "AGRICULTURE", label: "Food & Agriculture", aliases: ["agriculture", "agri", "food industry", "nông nghiệp", "nông sản"] },

  // ═══ ENERGY & UTILITIES ══════════════════════════════════════════════════════════════════════
  { key: "ENE_OILGAS", label: "Oil & Gas", parent: "ENERGY", aliases: ["oil & gas", "oil and gas", "petroleum", "upstream", "downstream", "refinery"] },
  { key: "ENE_RENEWABLES", label: "Renewables", parent: "ENERGY", aliases: ["renewable", "solar", "wind energy", "clean energy", "green energy", "hydrogen", "battery storage", "năng lượng tái tạo", "điện mặt trời", "điện gió"] },
  { key: "ENE_POWER", label: "Power & Grid", parent: "ENERGY", aliases: ["power generation", "electricity", "grid", "utility", "utilities", "power distribution", "điện lực", "thủy điện", "nhiệt điện"] },
  { key: "ENE_WATER", label: "Water & Waste", parent: "ENERGY", aliases: ["water treatment", "wastewater", "waste management", "recycling", "sanitation"] },
  { key: "ENE_MINING", label: "Mining & Extraction", parent: "ENERGY", aliases: ["mining", "metals extraction", "quarry", "minerals"] },
  { key: "ENERGY", label: "Energy & Utilities", aliases: ["energy", "cleantech", "utility company", "năng lượng", "dầu khí"] },

  // ═══ REAL ESTATE & CONSTRUCTION ══════════════════════════════════════════════════════════════
  { key: "RE_PROPTECH", label: "Proptech", parent: "REAL_ESTATE", aliases: ["proptech", "real estate software", "property management software"] },
  { key: "RE_COMMERCIAL", label: "Commercial Real Estate", parent: "REAL_ESTATE", aliases: ["commercial real estate", "cre", "office space", "retail space", "reit"] },
  { key: "RE_RESIDENTIAL", label: "Residential Real Estate", parent: "REAL_ESTATE", aliases: ["residential real estate", "housing", "property development", "homebuilder"] },
  { key: "RE_CONSTRUCTION", label: "Construction", parent: "REAL_ESTATE", aliases: ["construction", "contractor", "civil engineering", "infrastructure construction", "xây dựng", "nhà thầu", "xây lắp"] },
  { key: "RE_BUILDING_MATERIALS", label: "Building Materials", parent: "REAL_ESTATE", aliases: ["building materials", "cement", "concrete", "lumber", "roofing", "vật liệu xây dựng", "xi măng", "bê tông"] },
  { key: "RE_AEC", label: "Architecture & Engineering", parent: "REAL_ESTATE", aliases: ["architecture", "engineering firm", "aec", "design and build"] },
  { key: "REAL_ESTATE", label: "Real Estate & Construction", aliases: ["real estate", "property", "bất động sản"] },

  // ═══ TRANSPORT & LOGISTICS ═══════════════════════════════════════════════════════════════════
  { key: "LOG_FREIGHT", label: "Freight & Shipping", parent: "LOGISTICS", aliases: ["freight", "shipping", "cargo", "trucking", "haulage", "giao nhận", "vận chuyển", "hải quan"] },
  { key: "LOG_3PL", label: "Logistics & 3PL", parent: "LOGISTICS", aliases: ["logistics", "3pl", "supply chain", "fulfillment", "fulfilment", "last mile", "chuỗi cung ứng", "hậu cần"] },
  { key: "LOG_WAREHOUSING", label: "Warehousing", parent: "LOGISTICS", aliases: ["warehousing", "warehouse", "distribution center", "kho bãi", "trung tâm phân phối"] },
  { key: "LOG_MOBILITY", label: "Mobility & Rideshare", parent: "LOGISTICS", aliases: ["mobility", "rideshare", "ride-hailing", "micromobility", "car rental"] },
  { key: "LOG_MARITIME", label: "Maritime & Aviation", parent: "LOGISTICS", aliases: ["maritime", "shipping line", "port", "aviation logistics", "air cargo"] },
  { key: "LOGISTICS", label: "Transport & Logistics", aliases: ["transportation", "transport", "logistics company", "vận tải", "logistics"] },

  // ═══ MEDIA, MARKETING & ENTERTAINMENT ════════════════════════════════════════════════════════
  { key: "MED_ADTECH", label: "Advertising & Adtech", parent: "MEDIA", aliases: ["advertising", "adtech", "ad network", "programmatic", "dsp", "ad agency"] },
  { key: "MED_MARTECH", label: "Marketing & Martech", parent: "MEDIA", aliases: ["marketing", "martech", "digital marketing", "seo", "crm marketing", "email marketing", "tiếp thị số", "quảng cáo trực tuyến"] },
  { key: "MED_GAMING", label: "Gaming", parent: "MEDIA", aliases: ["gaming", "video games", "esports", "game studio", "mobile games"] },
  { key: "MED_PUBLISHING", label: "Publishing & News", parent: "MEDIA", aliases: ["publishing", "news", "newspaper", "magazine", "media outlet"] },
  { key: "MED_STREAMING", label: "Streaming & Video", parent: "MEDIA", aliases: ["streaming", "video platform", "ott", "content creator", "podcast"] },
  { key: "MED_MUSIC", label: "Music & Audio", parent: "MEDIA", aliases: ["music", "record label", "audio streaming"] },
  { key: "MEDIA", label: "Media & Entertainment", aliases: ["media", "entertainment", "content", "truyền thông", "giải trí"] },

  // ═══ PROFESSIONAL SERVICES ═══════════════════════════════════════════════════════════════════
  { key: "PRO_CONSULTING", label: "Consulting", parent: "PRO_SERVICES", aliases: ["consulting", "management consulting", "advisory", "strategy consulting", "tư vấn", "công ty tư vấn"] },
  { key: "PRO_LEGAL", label: "Legal & Legaltech", parent: "PRO_SERVICES", aliases: ["legal", "law firm", "legaltech", "compliance", "contract management", "pháp lý", "luật sư", "công ty luật"] },
  { key: "PRO_HR", label: "HR & Staffing", parent: "PRO_SERVICES", aliases: ["human resources", "hr tech", "recruiting", "staffing", "talent acquisition", "payroll", "nhân sự", "tuyển dụng"] },
  { key: "PRO_AGENCY", label: "Creative & Design Agency", parent: "PRO_SERVICES", aliases: ["design agency", "creative agency", "branding agency", "web agency"] },
  { key: "PRO_BPO", label: "BPO & Outsourcing", parent: "PRO_SERVICES", aliases: ["bpo", "outsourcing", "call center", "shared services", "customer support outsourcing", "thuê ngoài", "tổng đài"] },
  { key: "PRO_SERVICES", label: "Professional Services", aliases: ["professional services", "business services", "b2b services", "dịch vụ chuyên nghiệp", "dịch vụ doanh nghiệp"] },

  // ═══ EDUCATION ═══════════════════════════════════════════════════════════════════════════════
  { key: "EDU_EDTECH", label: "Edtech", parent: "EDUCATION", aliases: ["edtech", "e-learning", "elearning", "online courses", "lms", "học trực tuyến", "khóa học trực tuyến"] },
  { key: "EDU_SCHOOLS", label: "Schools & Higher Ed", parent: "EDUCATION", aliases: ["school", "university", "college", "higher education", "k-12", "trường học", "đại học", "trường đại học"] },
  { key: "EDU_TRAINING", label: "Corporate Training", parent: "EDUCATION", aliases: ["corporate training", "professional training", "certification", "upskilling", "đào tạo doanh nghiệp", "trung tâm đào tạo"] },
  { key: "EDUCATION", label: "Education", aliases: ["education", "learning", "giáo dục", "đào tạo"] },

  // ═══ TRAVEL & HOSPITALITY ════════════════════════════════════════════════════════════════════
  { key: "TRV_HOTELS", label: "Hotels & Lodging", parent: "TRAVEL", aliases: ["hotel", "lodging", "resort", "hospitality", "short-term rental", "khách sạn", "khu nghỉ dưỡng"] },
  { key: "TRV_AIRLINES", label: "Airlines & Travel", parent: "TRAVEL", aliases: ["airline", "travel booking", "ota", "tour operator", "travel agency", "hãng hàng không", "lữ hành", "đặt phòng"] },
  { key: "TRV_EVENTS", label: "Events & Tourism", parent: "TRAVEL", aliases: ["events", "event management", "tourism", "conference", "venue", "sự kiện", "tổ chức sự kiện"] },
  { key: "TRAVEL", label: "Travel & Hospitality", aliases: ["travel", "tourism industry", "du lịch"] },

  // ═══ PUBLIC SECTOR & NONPROFIT ═══════════════════════════════════════════════════════════════
  { key: "PUB_GOV", label: "Government & Govtech", parent: "PUBLIC", aliases: ["government", "public sector", "govtech", "municipal", "civic tech", "chính phủ", "nhà nước", "cơ quan nhà nước"] },
  { key: "PUB_DEFENSE", label: "Defense & Security", parent: "PUBLIC", aliases: ["defense", "defence", "military", "national security", "quốc phòng", "an ninh quốc gia"] },
  { key: "PUB_NONPROFIT", label: "Nonprofit & NGO", parent: "PUBLIC", aliases: ["nonprofit", "non-profit", "ngo", "charity", "social impact", "foundation", "phi lợi nhuận", "từ thiện"] },
  { key: "PUBLIC", label: "Public Sector & Nonprofit", aliases: ["public sector organization"] },
];

const BY_KEY = new Map(SERVED_VERTICAL_TAXONOMY.map((e) => [e.key, e]));

// Word-boundary alias matcher (cached). Substring matching mislabels: the short alias "ev" (automotive)
// matched inside "development"/"every", tagging unrelated companies "Automotive & Parts". Boundaries are
// the alphanumeric edges so aliases with "-", "/", "&" ("e-commerce", "ci/cd", "f&b", "3pl") still match.
// Boundaries are Unicode letter/number edges (\p{L}\p{N}) so Vietnamese aliases match correctly and
// can't fire mid-word next to an accented letter. Text and aliases are NFC-normalized (not
// accent-folded) — folding would collapse genuinely different Vietnamese words ("sữa" milk vs "sửa" repair).
const aliasMatcherCache = new Map<string, RegExp>();
function aliasMatcher(alias: string): RegExp {
  let re = aliasMatcherCache.get(alias);
  if (!re) {
    const escaped = alias.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    aliasMatcherCache.set(alias, re);
  }
  return re;
}

/**
 * Which served-vertical sector each Axis-1 category belongs to, used to break ties on the vertical
 * axis so the two labels agree: a food producer whose site also says "factory / sản xuất" must read
 * "Food & beverage producer · Food & Beverage", not "· Industrial & Manufacturing".
 *
 * It lives here, next to `classifyServedVerticals`, because both the presentation layer and the
 * scoring layer need it. It used to live in `presentIntelligence`, so only the drawer applied the
 * tie-break; `industryScore` called `classifyServedVerticals` without it and quietly added an
 * INDUSTRIAL token to every food manufacturer — enough to hit an ICP's excluded-industry list and
 * zero the industry dimension.
 */
export const CATEGORY_PREFERRED_SECTORS: Record<string, readonly string[]> = {
  food_beverage: ["AGRICULTURE"],
  agriculture_commodities: ["AGRICULTURE"],
  cpg_consumer_goods: ["CONSUMER"],
  retail_distribution: ["CONSUMER"],
  ecommerce_saas: ["CONSUMER"],
  marketplace: ["CONSUMER"],
  manufacturing: ["INDUSTRIAL"],
  semiconductor_electronics: ["INDUSTRIAL", "TECHNOLOGY"],
  chemicals_materials: ["INDUSTRIAL"],
  automotive: ["INDUSTRIAL"],
  construction_engineering: ["INDUSTRIAL"],
  hardware_iot: ["INDUSTRIAL", "TECHNOLOGY"],
  logistics: ["LOGISTICS"],
  energy: ["ENERGY"],
  healthtech: ["HEALTHCARE"],
  pharma: ["HEALTHCARE"],
  fintech: ["FINANCE"],
  fintech_payments: ["FINANCE"],
  fintech_lending: ["FINANCE"],
  insurance: ["FINANCE"],
  proptech: ["REAL_ESTATE"],
  real_estate: ["REAL_ESTATE"],
  education: ["EDUCATION"],
  hospitality_travel: ["TRAVEL"],
  legaltech: ["PRO_SERVICES"],
  hr_recruiting: ["PRO_SERVICES"],
  staffing_services: ["PRO_SERVICES"],
  agency: ["PRO_SERVICES", "MEDIA"],
  crm_martech: ["MEDIA", "TECHNOLOGY"],
  gaming_entertainment: ["MEDIA", "TECHNOLOGY"],
  telecom: ["TECHNOLOGY"],
  customer_intel: ["TECHNOLOGY"],
  data_analytics: ["TECHNOLOGY"],
  ai_automation: ["TECHNOLOGY"],
  cybersecurity: ["TECHNOLOGY"],
  devtools: ["TECHNOLOGY"],
  msp: ["TECHNOLOGY"],
  b2b_saas: ["TECHNOLOGY"],
};

export type ServedVerticalMatch = { key: string; label: string; parentKey: string | null; parentLabel: string | null };

/**
 * Classify free text (company description + facts + industry raw) into served verticals. Returns the
 * most-specific matches, de-duplicated so a leaf hit ("wool") suppresses its ancestors ("textiles",
 * "industrial"). Deterministic + pure. `limit` caps how many distinct verticals to return (default 2).
 */
export function classifyServedVerticals(
  text: string,
  limit = 2,
  preferSectors: readonly string[] = []
): ServedVerticalMatch[] {
  const haystack = String(text ?? "").normalize("NFC").toLowerCase();
  if (!haystack.trim()) return [];

  const hitKeys = new Set<string>();
  for (const entry of SERVED_VERTICAL_TAXONOMY) {
    if (entry.aliases.some((alias) => aliasMatcher(alias).test(haystack))) {
      hitKeys.add(entry.key);
    }
  }
  if (hitKeys.size === 0) return [];

  // Drop any hit that is an ancestor of another hit (keep the most specific per branch).
  const ancestors = new Set<string>();
  for (const key of hitKeys) {
    let p = BY_KEY.get(key)?.parent;
    while (p) {
      ancestors.add(p);
      p = BY_KEY.get(p)?.parent;
    }
  }

  const candidates: ServedVerticalMatch[] = [];
  // Preserve taxonomy order (most-specific-first) for stable output.
  for (const entry of SERVED_VERTICAL_TAXONOMY) {
    if (!hitKeys.has(entry.key) || ancestors.has(entry.key)) continue;
    const parent = entry.parent ? BY_KEY.get(entry.parent) ?? null : null;
    candidates.push({ key: entry.key, label: entry.label, parentKey: parent?.key ?? null, parentLabel: parent?.label ?? null });
  }

  // Prefer the branch that agrees with the caller's category. A Vietnamese food producer whose site
  // says "nhà máy / sản xuất" hits INDUSTRIAL as well as AGRI_FNB; without this the sector that
  // happens to sit earlier in the array wins and a food company reads "Industrial & Manufacturing".
  // Stable partition — relative taxonomy order is kept inside each group.
  if (preferSectors.length > 0) {
    const preferred = new Set(preferSectors);
    const isPreferred = (m: ServedVerticalMatch) => {
      let key: string | undefined = m.key;
      while (key) {
        if (preferred.has(key)) return true;
        key = BY_KEY.get(key)?.parent;
      }
      return false;
    };
    return [...candidates.filter(isPreferred), ...candidates.filter((m) => !isPreferred(m))].slice(0, limit);
  }

  return candidates.slice(0, limit);
}

/** "SaaS · FinTech" style label from a category label + the top served vertical. */
export function formatIndustryDetail(categoryLabel: string | null, verticals: ServedVerticalMatch[]): string | null {
  const cat = categoryLabel?.trim() || null;
  const top = verticals[0]?.label ?? null;
  if (cat && top) return `${cat} · ${top}`;
  return cat ?? top ?? null;
}

// ── Filter facet support ─────────────────────────────────────────────────────────────────────────

export type ServedVerticalTreeNode = {
  key: string;
  label: string;
  children: ServedVerticalTreeNode[];
};

/** The taxonomy as a hierarchical tree (sectors → verticals → leaves) for a filter facet. */
export function buildServedVerticalTree(): ServedVerticalTreeNode[] {
  const nodes = new Map<string, ServedVerticalTreeNode>(
    SERVED_VERTICAL_TAXONOMY.map((e) => [e.key, { key: e.key, label: e.label, children: [] }])
  );
  const roots: ServedVerticalTreeNode[] = [];
  for (const e of SERVED_VERTICAL_TAXONOMY) {
    const node = nodes.get(e.key)!;
    const parent = e.parent ? nodes.get(e.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * All aliases that should match a filter selection on `key` — the node's own aliases PLUS every
 * descendant's aliases (selecting "Textiles" also matches wool/cotton companies). Used to build the
 * WHERE clause (ILIKE ANY / token contains). Deterministic.
 */
export function verticalMatchAliases(key: string): string[] {
  const out = new Set<string>();
  const stack = [key];
  while (stack.length) {
    const k = stack.pop()!;
    const entry = BY_KEY.get(k);
    if (!entry) continue;
    for (const a of entry.aliases) out.add(a);
    for (const child of SERVED_VERTICAL_TAXONOMY) {
      if (child.parent === k) stack.push(child.key);
    }
  }
  return [...out];
}

/** Label for a vertical key (or the key itself if unknown). */
export function verticalLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Whether a key exists in the taxonomy (validate a client-supplied filter value). */
export function isServedVerticalKey(key: string): boolean {
  return BY_KEY.has(key);
}
