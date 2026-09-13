import type { BusinessModelKind, OfferingType } from "./contract";

// CINT3: rule-based business-category taxonomy (no LLM). Deterministic WORD-BOUNDARY keyword
// match over identity-bearing page/search text → category + offering type + business-model hint
// + a summary template. This is the "what does the company DO" axis (Axis 1); the served-vertical
// taxonomy (servedVertical.ts) supplies the "what industry/product does it sell/serve" axis (Axis 2),
// composed downstream into a "Category · Vertical" label (e.g. "SaaS · HR", "Manufacturing · Dairy").
//
// ## Two tiers, decided in order
//
// A flat list let a property developer win at `hr_recruiting` and a job board win at `food_beverage`,
// because every category competed on equal terms over the same bag of words. So the sector is settled
// first — is this a software company, a company that makes or owns physical things, or a company that
// sells people's time — and only categories in that sector are then scored. A wrong sector is a
// visible, debuggable error; a real-estate group filed under HR software is not.
//
// ## De-bias rules (see matchTaxonomy)
//
//  1. Matching is WORD-BOUNDARY, never substring — "ml" no longer matches "330ml", "api" no longer
//     matches "capital", "agents" no longer matches "distribution agents".
//  2. Keywords are specific: bare generic tokens (software, platform, api, automation, campaign) are
//     removed in favour of multiword phrases (software platform, marketing automation).
//  3. A category needs AT LEAST TWO distinct keyword hits to be assigned — one keyword is not enough
//     to classify, so a stray "supply chain" on a food site can't make it "logistics".
//  4. Only the THREE strongest hits count toward the score, so a category with a long keyword list
//     cannot win on volume alone.
//  5. A `generic` category (b2b_saas) only wins when no `specific` category qualifies. Snyk is a
//     security product that also says "SaaS"; the security answer is the useful one.
//  6. No qualifying category → null → the company reads "Unknown" (LOW confidence) rather than being
//     forced into the least-wrong bucket.

/** What kind of business this is — settled before any category is considered. */
export type Sector = "TECH" | "REAL_ECONOMY" | "SERVICES";

export type TaxonomyCategory = {
  id: string;
  label: string;
  sector: Sector;
  /** `generic` categories are fallbacks and never beat a `specific` one. */
  tier: "specific" | "generic";
  offeringType: OfferingType;
  businessModel: BusinessModelKind;
  vertical: string | null;
  keywords: string[];
  antiKeywords: string[];
  summaryTemplate: string; // {company} {offering}
};

// Strong physical/real-economy signals used as anti-keywords on the generic tech categories, so a
// food/retail/industrial page can't be captured by a stray "platform"/"automation" mention.
const REAL_ECONOMY_ANTI = [
  "beverage", "brewery", "dairy", "instant noodle", "confectionery", "packaged food",
  "supermarket", "plantation", "aquaculture", "factory", "fmcg",
  // vi
  "sữa", "bia", "thực phẩm", "nước giải khát", "bánh kẹo", "siêu thị", "nhà máy", "nông sản",
];

/**
 * Phrases that identify the SECTOR rather than the category.
 *
 * These are deliberately about how a business is run, not what market it touches: "our factories" and
 * "request a demo" say what kind of company you are dealing with, while "restaurants" or "healthcare"
 * say who the customer is. Sector markers must never include audience words, or the whole two-tier
 * split collapses back into the bug it exists to fix.
 */
const SECTOR_MARKERS: Record<Sector, string[]> = {
  TECH: [
    "software as a service", "saas", "our platform", "the platform", "request a demo", "book a demo",
    "free trial", "start free", "api documentation", "integrations", "per user per month",
    "cloud-based", "cloud based", "web app", "mobile app", "dashboard", "single sign-on",
    // vi
    "phần mềm", "nền tảng", "dùng thử miễn phí", "tích hợp",
  ],
  REAL_ECONOMY: [
    "manufacturing plant", "our factories", "our factory", "production facility", "production capacity",
    "our brands", "product portfolio", "distributors", "retail stores", "our stores", "our outlets",
    "property portfolio", "square metres", "square meters", "our fleet", "raw materials",
    "quality control", "iso 22000", "haccp", "our farms",
    // vi
    "nhà máy", "dây chuyền sản xuất", "sản phẩm của chúng tôi", "nhà phân phối", "đại lý",
    "công suất", "nguyên liệu", "trang trại",
  ],
  SERVICES: [
    "our consultants", "our engineers", "managed services", "we advise", "professional services",
    "client engagements", "our clients trust", "service level agreement", "on-site support",
    "project delivery", "outsourcing",
    // vi
    "đội ngũ tư vấn", "dịch vụ chuyên nghiệp", "triển khai dự án", "hỗ trợ tại chỗ",
  ],
};

export const CATEGORY_TAXONOMY: TaxonomyCategory[] = [
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // REAL ECONOMY — makes, grows, owns or sells physical things.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "food_beverage", label: "Food & beverage producer", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B2C", vertical: null,
    keywords: ["food and beverage", "food & beverage", "beverage", "brewery", "beer", "soft drink",
      "dairy", "milk", "yogurt", "infant formula", "nutrition products", "instant noodle", "noodle",
      "confectionery", "biscuit", "snack", "coffee", "roasted coffee", "instant coffee", "tea producer",
      "seafood", "food processing", "packaged food", "distillery", "winery", "spirits", "coconut water",
      "food manufacturer", "food producer", "sauces", "seasoning", "edible oil",
      // vi
      "thực phẩm", "đồ uống", "nước giải khát", "nước ngọt", "sữa", "sữa tươi", "sữa bột", "bia",
      "cà phê", "bánh kẹo", "mì ăn liền", "thủy sản", "chế biến thực phẩm", "nước mắm", "rượu", "trà"],
    antiKeywords: ["restaurant pos", "hospitality software", "restaurant management software"],
    summaryTemplate: "{company} is a food & beverage producer making {offering}.",
  },
  {
    id: "cpg_consumer_goods", label: "Consumer packaged goods / brand", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B2C", vertical: null,
    keywords: ["consumer packaged goods", "cpg", "fmcg", "consumer goods", "household goods",
      "personal care", "cosmetics", "skincare", "home care", "hygiene products", "consumer brand",
      "home appliances", "vitamins", "supplements", "haircare", "laundry",
      // vi
      "hàng tiêu dùng", "tiêu dùng nhanh", "mỹ phẩm", "hóa mỹ phẩm", "chăm sóc cá nhân"],
    antiKeywords: [],
    summaryTemplate: "{company} is a consumer packaged goods company producing {offering}.",
  },
  {
    id: "retail_distribution", label: "Retail & distribution", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2C", vertical: null,
    keywords: ["retailer", "retail chain", "supermarket", "hypermarket", "grocery store",
      "convenience store", "wholesale distribution", "distributor", "modern trade", "general trade",
      "fmcg distribution", "duty free", "specialty retail", "store network", "franchise stores",
      // vi
      "bán lẻ", "phân phối", "nhà phân phối", "siêu thị", "cửa hàng tiện lợi", "bán buôn", "bán sỉ",
      "đại lý phân phối", "chuỗi cửa hàng"],
    antiKeywords: [],
    summaryTemplate: "{company} is a retail / distribution business handling {offering}.",
  },
  {
    id: "agriculture_commodities", label: "Agriculture & commodities", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B", vertical: null,
    keywords: ["agriculture", "agribusiness", "farming", "plantation", "aquaculture", "livestock",
      "poultry", "cashew", "coconut", "rice production", "coffee beans", "commodity export",
      "agricultural products", "food ingredients", "cocoa", "grain", "oilseeds", "commodity trading",
      // vi
      "nông nghiệp", "nông sản", "trang trại", "chăn nuôi", "nuôi trồng thủy sản", "hạt điều",
      "lúa gạo", "dừa", "xuất khẩu nông sản", "cà phê nhân", "hồ tiêu"],
    antiKeywords: [],
    summaryTemplate: "{company} is an agriculture / commodities company producing {offering}.",
  },
  {
    // Generic for the same reason b2b_saas is: almost every real-economy company manufactures
    // something and says so, so "manufacturing" wins over "brewery" on a brewery's own site unless it
    // is held back. It is the answer only when nothing more specific fits.
    id: "manufacturing", label: "Manufacturing / industrial products", sector: "REAL_ECONOMY", tier: "generic",
    offeringType: "product", businessModel: "B2B", vertical: null,
    keywords: ["manufacturing", "industrial equipment", "factory", "production line", "machinery",
      "fabrication", "oem", "cnc", "assembly line", "industrial products", "contract manufacturing",
      "electronics manufacturing", "manufacturing solutions", "industrial automation",
      // vi
      "sản xuất", "nhà máy", "chế tạo", "cơ khí", "máy móc", "dây chuyền sản xuất", "khu công nghiệp"],
    antiKeywords: ["saas", "software platform"],
    summaryTemplate: "{company} is a manufacturing / industrial company producing {offering}.",
  },
  {
    id: "semiconductor_electronics", label: "Semiconductors & electronics", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B", vertical: null,
    keywords: ["semiconductor", "semiconductors", "wafer", "wafers", "foundry", "integrated circuits",
      "chip manufacturing", "chipmaker", "pcb assembly", "microelectronics", "process technology nodes",
      "fabless", "silicon", "semiconductor manufacturing", "chip fabrication", "nanometer",
      "feature-rich process", "analog and mixed signal"],
    antiKeywords: [],
    summaryTemplate: "{company} designs or fabricates semiconductors and electronics: {offering}.",
  },
  {
    id: "chemicals_materials", label: "Chemicals & materials", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B", vertical: null,
    keywords: ["industrial gases", "specialty chemicals", "petrochemical", "polymer", "polymers",
      "coatings", "adhesives", "chemical manufacturer", "materials science", "resins", "fertilizer",
      "industrial chemicals", "oxygen and nitrogen",
      // vi
      "hóa chất", "vật liệu", "khí công nghiệp", "phân bón"],
    antiKeywords: [],
    summaryTemplate: "{company} produces chemicals and materials: {offering}.",
  },
  {
    id: "pharma", label: "Pharmaceuticals", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B2C", vertical: "healthcare",
    keywords: ["pharmaceutical", "pharmaceuticals", "pharmaceutical manufacturer", "medicines",
      "drug discovery", "biopharmaceutical", "generic medicines", "prescription drugs",
      "over-the-counter", "clinical trials", "vaccines",
      // vi
      "dược phẩm", "thuốc", "sản xuất dược"],
    antiKeywords: ["telehealth", "electronic health record"],
    summaryTemplate: "{company} develops and manufactures pharmaceuticals: {offering}.",
  },
  {
    id: "automotive", label: "Automotive", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B2C", vertical: null,
    keywords: ["automotive manufacturer", "vehicle manufacturing", "auto parts", "car dealership",
      "electric vehicles", "passenger vehicles", "commercial vehicles", "automotive components",
      // vi
      "ô tô", "xe máy", "phụ tùng ô tô"],
    antiKeywords: [],
    summaryTemplate: "{company} builds vehicles or automotive components: {offering}.",
  },
  {
    id: "real_estate", label: "Real estate & property", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B2C", vertical: "real_estate",
    keywords: ["property developer", "real estate developer", "property development", "property portfolio",
      "shopping malls", "office towers", "residential development", "reit", "integrated developments",
      "property investment", "landlord", "business parks", "industrial parks", "serviced residences",
      "asset management portfolio", "lease space",
      // vi
      "bất động sản", "khu đô thị", "chủ đầu tư", "trung tâm thương mại", "cho thuê mặt bằng"],
    antiKeywords: ["property management software", "proptech"],
    summaryTemplate: "{company} develops and operates real estate: {offering}.",
  },
  {
    id: "energy", label: "Energy / utilities", sector: "REAL_ECONOMY", tier: "specific",
    offeringType: "product", businessModel: "B2B", vertical: "energy",
    // Scoped to words an energy OPERATOR uses about itself. "energy management", "carbon management",
    // "energy transition", "waste management" and "water treatment" were removed: they live in the
    // sustainability section of almost every industrial site, and were enough to file a contract
    // manufacturer, a shipyard and a sensor maker as utilities.
    keywords: ["renewable energy", "solar power", "clean energy", "smart grid",
      "utilities company", "oil and gas", "power generation", "power plants", "wind farm",
      "electricity generation", "energy producer",
      // vi
      "năng lượng tái tạo", "điện lực", "dầu khí", "điện mặt trời", "thủy điện", "nhà máy điện"],
    antiKeywords: [],
    summaryTemplate: "{company} serves the energy / utilities sector: {offering}.",
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // SERVICES — sells expertise, labour or operations rather than a product or a licence.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "logistics", label: "Freight forwarding and logistics", sector: "SERVICES", tier: "specific",
    offeringType: "service", businessModel: "B2B", vertical: null,
    keywords: ["freight forwarding", "freight", "cargo", "warehousing", "customs brokerage",
      "third party logistics", "3pl", "logistics provider", "logistics services", "shipping line",
      "parcel delivery", "express delivery", "last mile delivery", "supply chain solutions",
      // vi
      "vận tải", "kho bãi", "giao nhận", "hải quan", "chuỗi cung ứng", "vận chuyển", "logistics"],
    antiKeywords: ["logistics software", "saas", "warehouse management software"],
    summaryTemplate: "{company} is a freight forwarding and logistics company handling {offering}.",
  },
  {
    id: "construction_engineering", label: "Construction & engineering", sector: "SERVICES", tier: "specific",
    offeringType: "service", businessModel: "B2B", vertical: null,
    keywords: ["engineering, procurement", "epc", "construction services", "civil engineering",
      "shipyard", "offshore engineering", "subsea", "infrastructure projects", "general contractor",
      "design and build", "marine engineering", "rig repair", "turnkey projects", "newbuild",
      "offshore platforms", "fpso", "repairs and upgrades", "jack-up", "yard operations",
      // vi
      "xây dựng", "thi công", "nhà thầu", "cơ điện", "hạ tầng"],
    antiKeywords: ["construction software"],
    summaryTemplate: "{company} delivers construction and engineering work: {offering}.",
  },
  {
    id: "staffing_services", label: "Staffing, recruitment & job marketplaces", sector: "SERVICES", tier: "specific",
    offeringType: "service", businessModel: "B2B2C", vertical: null,
    keywords: ["job board", "job search", "job listings", "job vacancies", "apply for jobs",
      "recruitment agency", "staffing agency", "headhunting", "talent marketplace", "find jobs",
      "hiring platform", "job seekers", "post a job", "recruitment services",
      // vi
      "tìm việc", "việc làm", "tuyển dụng nhân sự", "ứng tuyển", "nhà tuyển dụng"],
    antiKeywords: [],
    summaryTemplate: "{company} connects employers and candidates: {offering}.",
  },
  {
    id: "agency", label: "Agency / consulting / services", sector: "SERVICES", tier: "specific",
    offeringType: "service", businessModel: "B2B", vertical: null,
    keywords: ["marketing agency", "creative agency", "consulting firm", "advisory services",
      "managed services", "outsourcing", "professional services", "system integrator",
      "influencer marketing", "brand agency",
      // vi
      "công ty tư vấn", "dịch vụ tư vấn", "đại lý quảng cáo", "dịch vụ chuyên nghiệp", "thuê ngoài"],
    antiKeywords: [],
    summaryTemplate: "{company} is a services firm providing {offering}.",
  },
  {
    id: "msp", label: "MSP / IT services", sector: "SERVICES", tier: "specific",
    offeringType: "service", businessModel: "B2B", vertical: null,
    keywords: ["managed service provider", "msp", "outsourced it", "managed it services",
      "it support services", "network services",
      // vi
      "công nghệ thông tin", "dịch vụ công nghệ thông tin", "giải pháp công nghệ", "tích hợp hệ thống"],
    antiKeywords: [],
    summaryTemplate: "{company} is an IT services / MSP provider: {offering}.",
  },
  {
    id: "insurance", label: "Insurance", sector: "SERVICES", tier: "specific",
    offeringType: "service", businessModel: "B2B2C", vertical: null,
    keywords: ["insurance products", "underwriting", "policyholders", "insurtech", "claims management",
      "life insurance", "general insurance", "reinsurance", "insurance broker",
      // vi
      "bảo hiểm", "bồi thường"],
    antiKeywords: [],
    summaryTemplate: "{company} underwrites or distributes insurance: {offering}.",
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // TECH / SOFTWARE. Keywords are specific multiword phrases so real-economy pages don't trip them.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "ecommerce_saas", label: "SaaS for ecommerce", sector: "TECH", tier: "specific",
    offeringType: "vertical_saas", businessModel: "B2B", vertical: "ecommerce",
    keywords: ["shopify", "ecommerce platform", "e-commerce platform", "dtc brand", "online store builder",
      "abandoned cart", "shopping cart software", "woocommerce", "magento", "headless commerce",
      "returns management", "cross-border ecommerce", "product discovery", "merchandising",
      "conversion rate optimization", "online merchants",
      // vi
      "thương mại điện tử", "sàn thương mại điện tử", "bán hàng trực tuyến"],
    antiKeywords: [],
    summaryTemplate: "{company} provides {offering} for ecommerce / DTC brands.",
  },
  {
    id: "customer_intel", label: "Customer intelligence / personalization software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    // Domain-specific tokens (personalization / segmentation) are safe as single words — they don't
    // appear on food/retail/industrial sites — so keep them rather than over-tighten to phrases.
    keywords: ["customer intelligence", "personalization", "customer data platform", "customer data",
      "audience segmentation", "segmentation", "customer insights", "customer engagement", "cdp",
      "loyalty program", "loyalty platform", "customer loyalty", "personalized offers",
      // vi
      "dữ liệu khách hàng", "phân khúc khách hàng", "cá nhân hóa"],
    antiKeywords: [],
    summaryTemplate: "{company} provides {offering} for marketing, CRM, and growth teams.",
  },
  {
    id: "crm_martech", label: "CRM / marketing automation", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["crm", "marketing automation", "email marketing", "lead generation software",
      "sales engagement", "marketing automation platform", "campaign management software",
      "cpq", "quote-to-cash", "sms marketing", "omnichannel marketing", "advertising platform",
      // vi
      "tự động hóa tiếp thị", "quản lý khách hàng", "chăm sóc khách hàng", "tiếp thị số"],
    antiKeywords: ["brewery", "dairy", "instant noodle", "supermarket"],
    summaryTemplate: "{company} offers {offering} for sales and marketing teams.",
  },
  {
    id: "data_analytics", label: "Data / analytics platform", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["analytics platform", "business intelligence", "data warehouse", "etl", "data pipeline",
      "reporting dashboard", "embedded analytics", "data lakehouse", "market intelligence",
      "competitive intelligence", "insights platform", "research platform", "patent analytics",
      "ip intelligence", "predictive analytics", "price monitoring", "survey data", "benchmarking data",
      // vi
      "phân tích dữ liệu", "kho dữ liệu", "báo cáo thông minh", "khai thác dữ liệu"],
    antiKeywords: [],
    summaryTemplate: "{company} provides {offering} for data and analytics teams.",
  },
  {
    id: "ai_automation", label: "AI / automation software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["artificial intelligence", "machine learning", "ai platform", "generative ai", "llm",
      "deep learning", "computer vision", "workflow automation", "robotic process automation",
      // vi
      "trí tuệ nhân tạo", "học máy", "tự động hóa quy trình", "thị giác máy tính"],
    antiKeywords: REAL_ECONOMY_ANTI,
    summaryTemplate: "{company} builds {offering} powered by AI/automation.",
  },
  {
    id: "cybersecurity", label: "Cybersecurity software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["cybersecurity", "security platform", "threat detection", "endpoint security", "siem",
      "vulnerability management", "zero trust", "firewall", "attack surface", "exposure management",
      "application security", "sast", "penetration testing", "security posture", "identity verification",
      "identity and access management", "customer identity", "fraud prevention", "kyc", "aml",
      "developer security", "open source security", "compliance automation",
      // vi
      "an ninh mạng", "bảo mật thông tin", "an toàn thông tin", "xác minh danh tính"],
    antiKeywords: [],
    summaryTemplate: "{company} provides {offering} for security teams.",
  },
  {
    id: "hr_recruiting", label: "HR / people software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["recruiting software", "applicant tracking", "ats", "hris", "hcm", "payroll software",
      "talent acquisition", "onboarding software", "human resources software", "hr software",
      "people platform", "employee onboarding", "performance management", "employee engagement",
      "workforce management", "time and attendance", "employee benefits", "employee recognition",
      "leave management", "hr platform",
      // vi
      "quản lý nhân sự", "phần mềm nhân sự", "tính lương", "chấm công"],
    antiKeywords: ["job board", "job listings", "recruitment agency"],
    summaryTemplate: "{company} offers {offering} for HR and people teams.",
  },
  {
    id: "fintech", label: "Fintech / financial software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["fintech", "financial software", "banking software", "digital banking",
      "digital wallet", "expense management software", "accounting software", "bookkeeping",
      "invoicing software", "credit risk data", "financial crime", "treasury management",
      "digital assets", "wealth management platform",
      // vi
      "công nghệ tài chính", "ngân hàng số", "ví điện tử", "tài chính số", "phần mềm kế toán"],
    antiKeywords: [],
    summaryTemplate: "{company} provides {offering} in fintech / financial software.",
  },
  {
    id: "fintech_payments", label: "Fintech / payments", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: "payments",
    keywords: ["payment gateway", "payment processing", "merchant acquiring", "card issuing",
      "payment orchestration", "psp", "billing platform", "payouts", "disbursements",
      "gift cards", "stored value", "payment security", "pci dss",
      // vi
      "cổng thanh toán", "thanh toán trực tuyến", "trung gian thanh toán"],
    antiKeywords: [],
    summaryTemplate: "{company} provides payments infrastructure: {offering}.",
  },
  {
    id: "fintech_lending", label: "Fintech / lending & credit", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: "lending",
    keywords: ["lending platform", "loan origination", "credit scoring", "bnpl", "buy now pay later",
      "underwriting software", "loan management",
      // vi
      "cho vay", "tín dụng", "chấm điểm tín dụng", "mua trước trả sau"],
    antiKeywords: [],
    summaryTemplate: "{company} offers lending / credit software: {offering}.",
  },
  {
    id: "healthtech", label: "Healthcare / healthtech", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: "healthcare",
    keywords: ["healthtech", "telehealth", "telemedicine", "electronic health record", "ehr",
      "clinical software", "patient engagement", "digital health", "health risk", "wellness platform",
      "medical claims", "patient data", "care management software",
      // vi
      "chăm sóc sức khỏe", "bệnh viện", "phòng khám", "y tế"],
    antiKeywords: ["pharmaceutical manufacturer"],
    summaryTemplate: "{company} provides {offering} for healthcare organizations.",
  },
  {
    id: "education", label: "Education / e-learning", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2C", vertical: "education",
    keywords: ["e-learning", "online courses", "learning management system", "lms", "edtech",
      "training platform", "online curriculum", "student recruitment", "student engagement",
      "admissions", "higher education", "universities and colleges",
      // vi
      "giáo dục", "đào tạo trực tuyến", "khóa học trực tuyến", "trường học", "trung tâm đào tạo"],
    antiKeywords: [],
    summaryTemplate: "{company} provides {offering} for learners and educators.",
  },
  {
    id: "devtools", label: "Developer tools / API platform", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: "developers",
    keywords: ["developer tools", "developer platform", "sdk", "api platform", "devops platform",
      "ci/cd", "developer experience", "observability platform", "infrastructure as code",
      // vi
      "công cụ lập trình", "nền tảng lập trình viên", "dành cho lập trình viên"],
    // Most B2B products publish developer docs. Without these, an accounting product's API portal
    // outscores its own accounting vocabulary.
    antiKeywords: ["accounting software", "invoicing software", "payroll software", "crm"],
    summaryTemplate: "{company} builds developer tooling: {offering}.",
  },
  {
    id: "legaltech", label: "Legaltech", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: "legal",
    keywords: ["legaltech", "contract management", "e-discovery", "clm", "matter management",
      "legal operations software",
      // vi
      "pháp lý", "luật sư", "quản lý hợp đồng", "công ty luật"],
    antiKeywords: [],
    summaryTemplate: "{company} provides legal software: {offering}.",
  },
  {
    id: "proptech", label: "Proptech / real estate software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: "real_estate",
    keywords: ["proptech", "property management software", "real estate platform", "tenant management",
      "facilities management software", "leasing software", "property listings", "property data",
      "repairs and maintenance platform", "property marketplace",
      // vi
      "quản lý tòa nhà", "cho thuê văn phòng"],
    antiKeywords: [],
    summaryTemplate: "{company} provides real-estate software: {offering}.",
  },
  {
    id: "hardware_iot", label: "Hardware / IoT", sector: "TECH", tier: "specific",
    offeringType: "product", businessModel: "B2B", vertical: null,
    keywords: ["internet of things", "iot platform", "connected devices", "embedded systems",
      "firmware", "edge computing", "industrial iot", "sensor network", "robotics", "autonomous robots",
      "inspection sensors", "scanning devices",
      // vi
      "internet vạn vật", "thiết bị thông minh", "cảm biến", "hệ thống nhúng"],
    // A foundry's site is full of the IoT and automotive markets it supplies. Those are its customers.
    antiKeywords: ["semiconductor", "wafer", "foundry"],
    summaryTemplate: "{company} builds hardware / IoT: {offering}.",
  },
  {
    id: "telecom", label: "Telecom & communications software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["telecommunications", "network operator", "carrier network", "5g network",
      "mobile network", "voice and data services", "unified communications", "call recording",
      "network cloud", "routing software", "telephony",
      // vi
      "viễn thông", "nhà mạng", "tổng đài"],
    antiKeywords: [],
    summaryTemplate: "{company} builds telecom and communications technology: {offering}.",
  },
  {
    id: "gaming_entertainment", label: "Gaming & entertainment", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B2C", vertical: null,
    keywords: ["mobile games", "casual games", "game studio", "gaming platform", "esports",
      "in-app games", "gamification", "streaming service", "video on demand", "ott platform",
      "content streaming", "player engagement",
      // vi
      "trò chơi", "game di động", "giải trí trực tuyến"],
    antiKeywords: [],
    summaryTemplate: "{company} builds games and entertainment experiences: {offering}.",
  },
  {
    id: "marketplace", label: "Marketplace", sector: "TECH", tier: "specific",
    offeringType: "marketplace", businessModel: "B2B2C", vertical: null,
    keywords: ["online marketplace", "two-sided marketplace", "buyers and sellers", "vendor marketplace",
      "on-demand platform", "gig platform", "b2b marketplace", "e-procurement", "online shopping platform",
      "shop online", "sellers and buyers",
      // vi
      "sàn giao dịch", "kết nối người mua", "nền tảng kết nối", "mua sắm trực tuyến"],
    antiKeywords: [],
    summaryTemplate: "{company} runs a marketplace: {offering}.",
  },
  {
    id: "hospitality_travel", label: "Hospitality / travel software", sector: "TECH", tier: "specific",
    offeringType: "saas", businessModel: "B2B", vertical: "hospitality",
    keywords: ["hospitality software", "hotel management", "property management system", "travel booking",
      "reservations software", "restaurant pos", "restaurant management software", "kitchen management",
      "restaurant operations", "food delivery platform", "table booking", "epos", "airport lounge",
      // vi
      "quản lý khách sạn", "đặt phòng", "quản lý nhà hàng"],
    antiKeywords: [],
    summaryTemplate: "{company} serves hospitality / travel: {offering}.",
  },
  {
    id: "b2b_saas", label: "B2B SaaS / software platform", sector: "TECH", tier: "generic",
    offeringType: "saas", businessModel: "B2B", vertical: null,
    keywords: ["saas", "software as a service", "b2b software platform", "enterprise software platform",
      "cloud software platform", "software solutions", "enterprise software",
      // vi
      "phần mềm doanh nghiệp", "nền tảng phần mềm", "giải pháp phần mềm"],
    antiKeywords: [],
    summaryTemplate: "{company} offers a B2B software platform: {offering}.",
  },
];

/** Sector of each category id — used by callers that only have the persisted category token. */
export const CATEGORY_SECTOR: Record<string, Sector> = Object.fromEntries(
  CATEGORY_TAXONOMY.map((category) => [category.id, category.sector])
);

export type TaxonomyMatch = {
  category: TaxonomyCategory;
  score: number;
  matchedKeywords: string[];
  /** Sector the markers settled on, or null when they were inconclusive. */
  sector: Sector | null;
};

// A category must clear this many DISTINCT keyword hits to be assigned. One keyword is not enough to
// classify — it is the primary guard against single-phrase misfires (e.g. a food page mentioning
// "supply chain" must not become "logistics").
export const MIN_KEYWORD_HITS = 2;

// Only the strongest few hits count. Without this a category with 30 keywords beats one with 8 purely
// on list length, which rewards whoever last edited the dictionary rather than the evidence.
const MAX_SCORING_HITS = 3;

// How decisively the sector markers must speak before they are allowed to exclude categories. Below
// this the sector is treated as unknown and every category competes, as before.
const SECTOR_MIN_HITS = 2;
const SECTOR_MIN_MARGIN = 2;

// How much a `generic` category's score is worth against a `specific` one. Tuned on the golden set:
// high enough that a six-keyword manufacturing match beats a two-keyword energy match, low enough
// that "we are SaaS" never beats "we are a security product".
const GENERIC_TIER_DISCOUNT = 0.6;

const wordCount = (keyword: string): number => keyword.trim().split(/\s+/).length;

// Word-boundary matcher for a keyword. Boundaries are Unicode letter/number edges (\p{L}\p{N}) rather
// than [a-z0-9], so Vietnamese keywords match correctly: "bia" (beer) must not fire inside "bìa", and a
// keyword must not match mid-word next to an accented letter. Keywords containing "-", "/", "&"
// ("e-commerce", "ci/cd", "food & beverage") still match cleanly. Cached per keyword.
//
// Text and keywords are NFC-normalized (not accent-folded) so Vietnamese diacritics stay meaningful —
// folding would collapse genuinely different words ("sữa" milk vs "sửa" repair both → "sua").
const matcherCache = new Map<string, RegExp>();
function keywordMatcher(keyword: string): RegExp {
  let re = matcherCache.get(keyword);
  if (!re) {
    const escaped = keyword.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    matcherCache.set(keyword, re);
  }
  return re;
}

/**
 * Settle the sector before any category is scored.
 *
 * Returns null unless one sector both clears SECTOR_MIN_HITS and beats the next by SECTOR_MIN_MARGIN.
 * An uncertain sector must not narrow the search — a wrong exclusion is worse than no exclusion,
 * because the right category becomes unreachable rather than merely outranked.
 */
export function detectSector(haystack: string): Sector | null {
  const scores = (Object.keys(SECTOR_MARKERS) as Sector[]).map((sector) => ({
    sector,
    hits: SECTOR_MARKERS[sector].filter((marker) => keywordMatcher(marker).test(haystack)).length,
  }));
  scores.sort((a, b) => b.hits - a.hits);

  const [best, second] = scores;
  if (!best || best.hits < SECTOR_MIN_HITS) return null;
  if (second && best.hits - second.hits < SECTOR_MIN_MARGIN) return null;
  return best.sector;
}

function scoreCategory(category: TaxonomyCategory, haystack: string) {
  const matched = category.keywords.filter((k) => keywordMatcher(k).test(haystack));
  if (matched.length < MIN_KEYWORD_HITS) return null;

  const strongest = [...matched].sort((a, b) => wordCount(b) - wordCount(a)).slice(0, MAX_SCORING_HITS);
  const positive = strongest.reduce((sum, k) => sum + wordCount(k), 0);
  const anti = category.antiKeywords.filter((k) => keywordMatcher(k).test(haystack)).length;
  const score = positive - anti * 2;
  if (score <= 0) return null;

  return { category, score, matched };
}

/** Best taxonomy match for the given text, or null when no category clears MIN_KEYWORD_HITS. */
export function matchTaxonomy(text: string): TaxonomyMatch | null {
  const haystack = text.normalize("NFC").toLowerCase();
  const sector = detectSector(haystack);

  const inSector = sector ? CATEGORY_TAXONOMY.filter((c) => c.sector === sector) : CATEGORY_TAXONOMY;
  // A confident sector that yields nothing falls back to the full list rather than returning null:
  // an unclassifiable company helps nobody, and the sector may simply lack the right category yet.
  const scoredInSector = inSector.map((c) => scoreCategory(c, haystack)).filter(Boolean);
  const scored = (scoredInSector.length > 0
    ? scoredInSector
    : CATEGORY_TAXONOMY.map((c) => scoreCategory(c, haystack)).filter(Boolean)) as Array<
    NonNullable<ReturnType<typeof scoreCategory>>
  >;

  if (scored.length === 0) return null;

  // Generic categories are DISCOUNTED, not excluded.
  //
  // Excluding them outright was worse than the problem it solved: Jabil's site matches six
  // manufacturing keywords and two energy ones, and dropping the generic bucket handed the verdict to
  // energy — a contract manufacturer filed as a utility. A discount keeps a specific category ahead
  // on comparable evidence (Snyk stays cybersecurity rather than "SaaS") while still letting an
  // overwhelming generic match win over a thin specific one.
  const effective = (candidate: { score: number; category: TaxonomyCategory }) =>
    candidate.category.tier === "generic" ? candidate.score * GENERIC_TIER_DISCOUNT : candidate.score;

  let best = scored[0];
  for (const candidate of scored.slice(1)) {
    const candidateScore = effective(candidate);
    const bestScore = effective(best);
    if (
      candidateScore > bestScore ||
      (candidateScore === bestScore && candidate.matched.length > best.matched.length)
    ) {
      best = candidate;
    }
  }

  return { category: best.category, score: best.score, matchedKeywords: best.matched, sector };
}

// Map a noisy imported industry label onto a SINGLE canonical taxonomy keyword phrase. Appending this
// to the classification text lets it contribute at most ONE keyword hit — so the imported industry can
// help a category that already has web evidence clear MIN_KEYWORD_HITS, or break a tie, but can never
// assign a category by itself (a wrong "Machinery" tag can't fabricate a manufacturing label). Returns
// "" when the label maps to nothing recognised. Deterministic, order-sensitive (first match wins).
// Each hint keyword MUST be a single taxonomy keyword that does not embed another keyword of its
// category — otherwise one hint would produce two distinct hits and could cross MIN_KEYWORD_HITS on
// its own (e.g. "food and beverage" embeds the bounded token "beverage").
const LINKEDIN_INDUSTRY_HINTS: Array<{ match: RegExp; keyword: string }> = [
  { match: /food|beverage|f&b|dairy|confectionery|noodle|brewery|beer|coffee|tea|snack|milk/i, keyword: "packaged food" },
  { match: /consumer goods|fmcg|cpg|personal care|cosmetic|household/i, keyword: "consumer goods" },
  { match: /retail|wholesale|distribution|supermarket/i, keyword: "retailer" },
  { match: /agri|farm|aquacultur|livestock|poultry|plantation|import\s*&?\s*export/i, keyword: "agriculture" },
  { match: /machinery|industrial|manufactur|factory|fabrication/i, keyword: "machinery" },
  { match: /logistic|freight|shipping|transport|supply chain/i, keyword: "logistics services" },
  { match: /pharma|health|medical|hospital|clinic/i, keyword: "healthtech" },
  { match: /bank|financ|insurance|payment/i, keyword: "financial software" },
];

export function linkedInIndustryHint(industryRaw?: string | null): string {
  const text = (industryRaw ?? "").trim();
  if (!text) return "";
  for (const { match, keyword } of LINKEDIN_INDUSTRY_HINTS) {
    if (match.test(text)) return keyword;
  }
  return "";
}
