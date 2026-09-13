// Golden set for company classification accuracy.
//
// Every case is a REAL company whose site was crawled once and snapshotted into
// `classificationPages/<domain>.json` by `scripts/capture-classification-fixtures.mjs`. The accuracy
// test replays those snapshots through the real reasoning pipeline — no network, fully repeatable.
//
// Why a labelled set exists at all: the classifier was changed twice without a way to tell whether
// accuracy went up or down, and both times a regression shipped (a de-biased taxonomy that never
// reached the database, then a served-vertical tie-break that only landed in the presentation layer).
// A number you can re-measure is the only thing that makes the next change safe.
//
// Labelling rules, so the set stays defensible:
//   - `sector` answers "what kind of business is this", not "who does it sell to". A SaaS product for
//     restaurants is TECH, never REAL_ECONOMY — that confusion is the single largest error class the
//     set exists to catch (advocadoapp, grabjobs, syrve, grubtech, supy, foodsconnected).
//   - `category` is the most specific category that is clearly right. When a company genuinely spans
//     two, it is left OUT of the set rather than given a coin-flip label — a golden set with arguable
//     entries measures the labeller, not the classifier.
//   - Companies whose real business could not be established with confidence were excluded outright.

export type GoldenSector = "TECH" | "REAL_ECONOMY" | "SERVICES";

export type GoldenCase = {
  /** Canonical domain — also the fixture filename. */
  domain: string;
  name: string;
  sector: GoldenSector;
  /** Expected taxonomy category id. */
  category: string;
  /** Why this label, especially where the classifier is known to get it wrong. */
  why: string;
};

export const CLASSIFICATION_GOLDEN: GoldenCase[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // REAL ECONOMY — Vietnamese food & beverage producers. Most arrive from LinkedIn/CSV tagged
  // "Machinery" or "Consumer Goods", so they also test that a wrong imported industry cannot win.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  { domain: "vinamilk.com.vn", name: "Vinamilk", sector: "REAL_ECONOMY", category: "food_beverage", why: "Dairy producer — milk, yoghurt, infant formula." },
  { domain: "thmilk.vn", name: "TH Group", sector: "REAL_ECONOMY", category: "food_beverage", why: "Fresh-milk producer with its own dairy herd." },
  { domain: "vitadairy.vn", name: "VitaDairy", sector: "REAL_ECONOMY", category: "food_beverage", why: "Dairy and nutrition producer." },
  { domain: "nutricare.com.vn", name: "Nutricare", sector: "REAL_ECONOMY", category: "food_beverage", why: "Nutrition and milk-powder producer." },
  { domain: "lof.vn", name: "LOF (Dutch Lady)", sector: "REAL_ECONOMY", category: "food_beverage", why: "Dairy producer; arrives tagged 'Machinery'." },
  { domain: "nutifood.com.vn", name: "Nutifood", sector: "REAL_ECONOMY", category: "food_beverage", why: "Nutrition and dairy producer." },
  { domain: "sabeco.com.vn", name: "Sabeco", sector: "REAL_ECONOMY", category: "food_beverage", why: "Brewery — Saigon Beer." },
  { domain: "habeco.com.vn", name: "Habeco", sector: "REAL_ECONOMY", category: "food_beverage", why: "Brewery — Hanoi Beer." },
  { domain: "heineken-vietnam.com.vn", name: "Heineken Vietnam", sector: "REAL_ECONOMY", category: "food_beverage", why: "Brewery." },
  { domain: "carlsbergvietnam.vn", name: "Carlsberg Vietnam", sector: "REAL_ECONOMY", category: "food_beverage", why: "Brewery." },
  { domain: "sapporovietnam.com.vn", name: "Sapporo Vietnam", sector: "REAL_ECONOMY", category: "food_beverage", why: "Brewery." },
  { domain: "trungnguyenlegend.com", name: "Trung Nguyen Legend", sector: "REAL_ECONOMY", category: "food_beverage", why: "Coffee roaster and brand." },
  { domain: "highlandscoffee.com.vn", name: "Highlands Coffee", sector: "REAL_ECONOMY", category: "food_beverage", why: "Coffee brand and chain operator." },
  { domain: "kingcoffee.com", name: "TNI King Coffee", sector: "REAL_ECONOMY", category: "food_beverage", why: "Coffee producer and brand." },
  { domain: "vinacafebienhoa.com", name: "Vinacafe", sector: "REAL_ECONOMY", category: "food_beverage", why: "Instant-coffee producer." },
  { domain: "vinatea.com.vn", name: "Vinatea", sector: "REAL_ECONOMY", category: "food_beverage", why: "Tea producer; arrives tagged 'Machinery'." },
  { domain: "bibica.com.vn", name: "Bibica", sector: "REAL_ECONOMY", category: "food_beverage", why: "Confectionery producer." },
  { domain: "haihaco.com.vn", name: "Hai Ha", sector: "REAL_ECONOMY", category: "food_beverage", why: "Confectionery producer." },
  { domain: "richy.com.vn", name: "Richy Group", sector: "REAL_ECONOMY", category: "food_beverage", why: "Biscuit and snack producer; tagged 'Machinery'." },
  { domain: "bichchi.com.vn", name: "Bich Chi Food", sector: "REAL_ECONOMY", category: "food_beverage", why: "Rice-paper and noodle producer; tagged 'Machinery'." },
  { domain: "thienhuongfood.com", name: "Thien Huong Food", sector: "REAL_ECONOMY", category: "food_beverage", why: "Instant-noodle producer; tagged 'Machinery'." },
  { domain: "vifon.com.vn", name: "Vifon", sector: "REAL_ECONOMY", category: "food_beverage", why: "Instant-noodle producer." },
  { domain: "acecookvietnam.vn", name: "Acecook Vietnam", sector: "REAL_ECONOMY", category: "food_beverage", why: "Instant-noodle producer." },
  { domain: "cholimexfood.com.vn", name: "Cholimex Food", sector: "REAL_ECONOMY", category: "food_beverage", why: "Sauces and processed-food producer." },
  { domain: "masanconsumer.com", name: "Masan Consumer", sector: "REAL_ECONOMY", category: "food_beverage", why: "Packaged food and sauces producer." },
  { domain: "nestle.com.vn", name: "Nestle Vietnam", sector: "REAL_ECONOMY", category: "food_beverage", why: "Food and beverage producer; tagged 'Machinery'." },
  { domain: "mondelezinternational.com", name: "Mondelez", sector: "REAL_ECONOMY", category: "food_beverage", why: "Snack and confectionery producer." },
  { domain: "perfettivanmelle.com", name: "Perfetti Van Melle", sector: "REAL_ECONOMY", category: "food_beverage", why: "Confectionery producer." },
  { domain: "urc.com.vn", name: "URC Vietnam", sector: "REAL_ECONOMY", category: "food_beverage", why: "Snack and beverage producer." },
  { domain: "suntorypepsico.vn", name: "Suntory PepsiCo", sector: "REAL_ECONOMY", category: "food_beverage", why: "Soft-drink producer." },
  { domain: "yakult.vn", name: "Yakult Vietnam", sector: "REAL_ECONOMY", category: "food_beverage", why: "Probiotic-drink producer; arrives tagged 'Retail'." },
  { domain: "betrimex.com.vn", name: "Betrimex", sector: "REAL_ECONOMY", category: "food_beverage", why: "Coconut-water and coconut-food producer." },

  // Agriculture / commodities — upstream of F&B, deliberately a different category.
  { domain: "phucsinh.com", name: "Phuc Sinh", sector: "REAL_ECONOMY", category: "agriculture_commodities", why: "Coffee and pepper grower/exporter, not a packaged-food brand." },
  { domain: "luongquoi.vn", name: "Luong Quoi Coconut", sector: "REAL_ECONOMY", category: "agriculture_commodities", why: "Coconut processing and commodity export." },
  { domain: "cargill.nl", name: "Cargill", sector: "REAL_ECONOMY", category: "agriculture_commodities", why: "Agricultural commodity trading and processing." },
  { domain: "ofi.com", name: "ofi (Olam Food Ingredients)", sector: "REAL_ECONOMY", category: "agriculture_commodities", why: "Food-ingredient sourcing and processing at commodity scale." },

  // Consumer packaged goods — non-food branded consumer products.
  { domain: "unilever.com", name: "Unilever", sector: "REAL_ECONOMY", category: "cpg_consumer_goods", why: "Home, personal care and food brands. Currently classified as NULL." },
  { domain: "dyson.com", name: "Dyson", sector: "REAL_ECONOMY", category: "cpg_consumer_goods", why: "Consumer appliances designed and manufactured in-house." },
  { domain: "swisse.us", name: "Swisse", sector: "REAL_ECONOMY", category: "cpg_consumer_goods", why: "Vitamin and supplement brand. Currently classified as 'logistics'." },

  // Retail & distribution.
  { domain: "valiram.com", name: "Valiram", sector: "REAL_ECONOMY", category: "retail_distribution", why: "Luxury retail and brand distribution group. Currently classified as 'crm_martech'." },

  // Real estate — an entire category the taxonomy is missing today.
  { domain: "capitaland.com", name: "CapitaLand", sector: "REAL_ECONOMY", category: "real_estate", why: "Property developer and investment manager. Currently classified as 'hr_recruiting' off its careers pages." },
  { domain: "frasersproperty.com", name: "Frasers Property", sector: "REAL_ECONOMY", category: "real_estate", why: "Property developer. Currently 'logistics' because it develops industrial/logistics estates." },
  { domain: "mapletree.com.sg", name: "Mapletree", sector: "REAL_ECONOMY", category: "real_estate", why: "Real-estate investment and development group." },

  // Industrials, chemicals, electronics.
  { domain: "airliquide.com", name: "Air Liquide", sector: "REAL_ECONOMY", category: "chemicals_materials", why: "Industrial gases producer. Currently 'healthtech' off its medical-gas pages." },
  { domain: "abb.com.sg", name: "ABB", sector: "REAL_ECONOMY", category: "manufacturing", why: "Electrification and automation equipment manufacturer." },
  { domain: "jabil.com", name: "Jabil", sector: "REAL_ECONOMY", category: "manufacturing", why: "Diversified contract manufacturing (EMS) across industries — not semiconductor fabrication. Currently 'logistics' off its supply-chain pages." },
  { domain: "gf.com", name: "GlobalFoundries", sector: "REAL_ECONOMY", category: "semiconductor_electronics", why: "Semiconductor foundry." },
  { domain: "seatrium.com", name: "Seatrium", sector: "SERVICES", category: "construction_engineering", why: "Offshore and marine engineering — sells project delivery, not a catalogue product." },
  { domain: "sembcorp.com", name: "Sembcorp", sector: "REAL_ECONOMY", category: "energy", why: "Power generation and utilities." },
  { domain: "unilab.com.ph", name: "Unilab", sector: "REAL_ECONOMY", category: "pharma", why: "Pharmaceutical manufacturer, not health software." },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // SERVICES
  // ───────────────────────────────────────────────────────────────────────────────────────────
  { domain: "dhl.com", name: "DHL", sector: "SERVICES", category: "logistics", why: "Freight forwarding and parcel delivery operator." },
  { domain: "oceantg.com", name: "Ocean Technologies Group", sector: "TECH", category: "education", why: "Maritime training and e-learning (Videotel, Seagull). Labelled 'construction_engineering' here at first — that was a labelling error, the classifier was right." },

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // TECH — the "sells software to industry X" cases that are currently read as "is industry X".
  // ───────────────────────────────────────────────────────────────────────────────────────────
  { domain: "advocadoapp.com", name: "Advocado", sector: "TECH", category: "crm_martech", why: "Marketing/loyalty SaaS SOLD TO restaurants. Currently 'food_beverage'." },
  { domain: "grabjobs.co", name: "GrabJobs", sector: "SERVICES", category: "staffing_services", why: "Job board and recruitment platform — its product is the vacancies, not software licences. Currently 'food_beverage' because it lists F&B roles." },
  { domain: "syrve.com", name: "Syrve", sector: "TECH", category: "hospitality_travel", why: "Restaurant ERP/POS software. Currently 'data_analytics'." },
  { domain: "grubtech.com", name: "Grubtech", sector: "TECH", category: "hospitality_travel", why: "Restaurant operations software. Currently generic 'b2b_saas'." },
  { domain: "supy.io", name: "Supy", sector: "TECH", category: "hospitality_travel", why: "Restaurant inventory software. Currently 'ai_automation'." },
  { domain: "zonal.co.uk", name: "Zonal", sector: "TECH", category: "hospitality_travel", why: "Hospitality EPOS and booking software. Currently 'crm_martech'." },
  { domain: "foodsconnected.com", name: "Foods Connected", sector: "TECH", category: "b2b_saas", why: "Supply-chain quality software SOLD TO food businesses — software, not food." },

  // TECH — specific categories currently swallowed by the generic b2b_saas bucket.
  { domain: "snyk.io", name: "Snyk", sector: "TECH", category: "cybersecurity", why: "Developer security platform. Currently generic 'b2b_saas'." },
  { domain: "ionix.io", name: "IONIX", sector: "TECH", category: "cybersecurity", why: "Attack-surface management. Currently generic 'b2b_saas'." },
  { domain: "inforcer.com", name: "Inforcer", sector: "TECH", category: "cybersecurity", why: "Microsoft 365 security posture management." },
  { domain: "sumsub.com", name: "Sumsub", sector: "TECH", category: "cybersecurity", why: "Identity verification and fraud prevention. Currently generic 'b2b_saas'." },
  { domain: "devcodeidentity.com", name: "Devcode Identity", sector: "TECH", category: "cybersecurity", why: "Customer identity and access management. Currently generic 'b2b_saas'." },
  { domain: "hibob.com", name: "HiBob", sector: "TECH", category: "hr_recruiting", why: "HRIS/HCM platform. Currently generic 'b2b_saas' — the mirror image of CapitaLand landing in hr_recruiting." },
  { domain: "justlogin.com", name: "JustLogin", sector: "TECH", category: "hr_recruiting", why: "HR, payroll and leave software." },
  { domain: "perkbox.com", name: "Perkbox", sector: "TECH", category: "hr_recruiting", why: "Employee benefits and recognition platform. Currently 'ai_automation'." },

  // TECH — the rest, spread across categories so the set is not only failure cases.
  { domain: "xero.com", name: "Xero", sector: "TECH", category: "fintech", why: "Cloud accounting software." },
  { domain: "ravelin.com", name: "Ravelin", sector: "TECH", category: "fintech", why: "Payment fraud detection." },
  { domain: "encompasscorporation.com", name: "Encompass", sector: "TECH", category: "fintech", why: "KYB / corporate onboarding automation for banks." },
  { domain: "redflagalert.com", name: "Red Flag Alert", sector: "TECH", category: "fintech", why: "Business credit risk data and scoring." },
  { domain: "runa.io", name: "Runa", sector: "TECH", category: "fintech_payments", why: "Payouts and disbursement infrastructure." },
  { domain: "pcipal.com", name: "PCI Pal", sector: "TECH", category: "fintech_payments", why: "Secure payment capture for contact centres." },
  { domain: "diggecard.com", name: "Diggecard", sector: "TECH", category: "fintech_payments", why: "Gift-card and stored-value platform." },
  { domain: "ometria.com", name: "Ometria", sector: "TECH", category: "customer_intel", why: "Retail customer data platform." },
  { domain: "useinsider.com", name: "Insider", sector: "TECH", category: "customer_intel", why: "Customer data and personalization platform." },
  { domain: "eagleeye.com", name: "Eagle Eye", sector: "TECH", category: "customer_intel", why: "Loyalty and personalized promotions platform." },
  { domain: "dotdigital.com", name: "Dotdigital", sector: "TECH", category: "crm_martech", why: "Email and cross-channel marketing automation." },
  { domain: "dealhub.io", name: "DealHub", sector: "TECH", category: "crm_martech", why: "CPQ and sales engagement platform." },
  { domain: "athoscommerce.com", name: "Athos Commerce", sector: "TECH", category: "ecommerce_saas", why: "Ecommerce merchandising and search software." },
  { domain: "swap-commerce.com", name: "Swap", sector: "TECH", category: "ecommerce_saas", why: "Ecommerce returns and cross-border operations software." },
  { domain: "shopee.com", name: "Shopee", sector: "TECH", category: "marketplace", why: "Consumer ecommerce marketplace. Currently classified as NULL." },
  { domain: "patsnap.com", name: "PatSnap", sector: "TECH", category: "data_analytics", why: "IP and R&D analytics platform." },
  { domain: "mobysoft.com", name: "Mobysoft", sector: "TECH", category: "data_analytics", why: "Predictive analytics for social housing arrears." },
  { domain: "skuuudle.com", name: "Skuuudle", sector: "TECH", category: "data_analytics", why: "Competitive price monitoring data." },
  { domain: "mygrowdash.com", name: "Growdash", sector: "TECH", category: "data_analytics", why: "Restaurant delivery analytics — analytics software, not a restaurant." },
  { domain: "edgeprop.sg", name: "EdgeProp Singapore", sector: "TECH", category: "proptech", why: "Property listings, data and analytics. Currently 'data_analytics'." },
  { domain: "plentific.com", name: "Plentific", sector: "TECH", category: "proptech", why: "Property repairs and maintenance marketplace software. Currently 'fintech'." },
  { domain: "geckoengage.com", name: "Gecko", sector: "TECH", category: "education", why: "Student recruitment and engagement software for universities." },
  { domain: "aktivolabs.com", name: "Aktivo Labs", sector: "TECH", category: "healthtech", why: "Digital health risk analytics. Currently 'cybersecurity'." },
  { domain: "klaim.ai", name: "Klaim", sector: "TECH", category: "healthtech", why: "Medical claims financing and automation." },
  { domain: "goama.com", name: "Goama", sector: "TECH", category: "gaming_entertainment", why: "In-app social gaming platform. Currently 'cybersecurity'." },
  { domain: "drivenets.com", name: "DriveNets", sector: "TECH", category: "telecom", why: "Network cloud software for carriers." },
  { domain: "teleware.com", name: "TeleWare", sector: "TECH", category: "telecom", why: "Mobile voice recording and compliant communications." },
  { domain: "dexory.com", name: "Dexory", sector: "TECH", category: "hardware_iot", why: "Warehouse robots plus their data platform." },
  { domain: "screeningeagle.com", name: "Screening Eagle", sector: "TECH", category: "hardware_iot", why: "Inspection sensors and the software that reads them." },
  // OpenText was labelled b2b_saas here and removed again: after the Micro Focus acquisition its site
  // leads as heavily with security as with information management, so both answers are defensible.
  // The labelling rule at the top of this file says such a company is excluded rather than given a
  // coin-flip label — keeping it would have measured the labeller.
  { domain: "orbussoftware.com", name: "Orbus Software", sector: "TECH", category: "b2b_saas", why: "Enterprise architecture software." },
  { domain: "realvnc.com", name: "RealVNC", sector: "TECH", category: "b2b_saas", why: "Remote access software." },
];

/** Fixture directory, relative to this file. */
export const CLASSIFICATION_FIXTURE_DIR = "classificationPages";
