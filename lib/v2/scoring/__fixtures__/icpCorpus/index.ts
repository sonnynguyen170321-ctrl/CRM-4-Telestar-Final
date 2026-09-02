import type { IcpVersionRulesV2 } from "../../rules/schema-v2";
import {
  defineIcp,
  defaultGeography,
  defaultIndustry,
  defaultPersona,
  defaultSize,
} from "./defineIcp";

// The 18 real client ICPs from docs/v2/plan/V2_ICP_CORPUS.md encoded as schema-v2
// rules. Each states only its distinctive dimensions; defineIcp fills the rest.
// Golden company fixtures + expected outcomes live in ./goldenCases. Fixture-only.

export const STORMWALL = defineIcp({
  ruleSetId: "corpus-01-stormwall",
  displayName: "Stormwall — DDoS / network protection",
  geography: defaultGeography({
    targetRegions: ["MENA", "SEA", "EUROPE"],
    targetCountries: ["India", "Pakistan", "Bangladesh", "Saudi Arabia", "Singapore"],
    priorityTiers: [{ tier: 1, countries: ["Saudi Arabia", "United Arab Emirates", "Singapore"], weightBonus: 0 }],
  }),
  industry: defaultIndustry({ industryKeywords: ["isp", "telecom", "hosting", "banking", "gaming", "ip telephony"] }),
  persona: defaultPersona({
    titleAllowlist: ["CISO", "CTO", "security engineer", "system admin", "network engineer", "network operator", "general manager"],
  }),
  size: defaultSize({ excludeTooSmall: true }),
});

export const ONECLOUDHUB = defineIcp({
  ruleSetId: "corpus-02-1cloudhub",
  displayName: "1CloudHub — cloud / infra (Singapore only)",
  geography: defaultGeography({ targetCountries: ["Singapore"] }),
  persona: defaultPersona({
    titleAllowlist: ["IT Manager", "Head of IT", "CTO", "CIO", "Director of IT", "Head of Infrastructure", "Chief Architect"],
    // "no engineer titles"
    titleDenylist: ["engineer"],
  }),
});

export const SAIGON_TECH = defineIcp({
  ruleSetId: "corpus-03-saigontech",
  displayName: "Saigon Technology — software outsourcing",
  geography: defaultGeography({ targetCountries: ["New Zealand", "Germany", "Australia"] }),
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["BANKING", "HEALTHCARE", "FINANCE"] }),
  persona: defaultPersona({ titleKeywords: ["ai", "it", "technical", "tech lead", "engineer", "software", "ceo", "cto"] }),
  size: defaultSize({ minEmployees: 2, maxEmployees: 500 }),
});

export const DPOINT = defineIcp({
  ruleSetId: "corpus-04-dpoint",
  displayName: "Dpoint — CDP / loyalty",
  geography: defaultGeography({ targetCountries: ["Vietnam"] }),
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["RETAIL", "FNB", "FMCG"] }),
  persona: defaultPersona({
    titleKeywords: ["marketing", "partnerships", "customer experience", "alliances", "customer success", "channel", "omnichannel", "ceo", "cmo"],
  }),
  size: defaultSize({ sizeBands: ["MEDIUM", "MID_MARKET", "ENTERPRISE", "LARGE_ENTERPRISE"] }),
  disqualifiers: { competitorDenylist: ["Vinamilk"] },
});

export const STS = defineIcp({
  ruleSetId: "corpus-05-sts",
  displayName: "STS — Epicor ERP for Manufacturing",
  geography: defaultGeography({ locationScope: "any_office", requiredOfficeCountries: ["Vietnam"] }),
  industry: defaultIndustry({ industryKeywords: ["furniture", "plastics", "rubber", "industrial machinery", "electronics", "fabricated metals"] }),
  persona: defaultPersona({
    titleAllowlist: ["CEO", "COO", "IT Director", "Factory Director", "Plant Director", "Chief Accountant", "Production Director"],
  }),
  size: defaultSize({ sizeBands: ["MEDIUM", "MID_MARKET"] }),
});

export const TELESTAR = defineIcp({
  ruleSetId: "corpus-06-telestar",
  displayName: "TeleStar — BPO / B2B outbound (house ICP)",
  geography: defaultGeography({
    targetCountries: ["Australia", "Singapore", "Hong Kong", "Vietnam", "Japan", "Ireland", "Norway", "Switzerland", "Denmark", "Netherlands", "Iceland", "Sweden", "Finland", "United Kingdom", "Canada", "United States", "Israel"],
    excludedCountries: ["India", "Pakistan", "Bangladesh", "Philippines"],
    locationScope: "any_office",
    excludedOfficeCountries: ["India", "Pakistan", "Bangladesh", "Philippines"],
  }),
  industry: defaultIndustry({ industryKeywords: ["saas", "software", "platform", "product"] }),
  companyType: {
    allow: ["PRODUCT_SAAS", "PRODUCT_PLATFORM"],
    deny: ["AGENCY"],
    servicesConsultingPolicy: { disqualify: true, exceptMarkets: ["Vietnam"] },
  },
  persona: defaultPersona({
    titleAllowlist: ["Founder", "CEO", "COO", "CRO", "VP Sales", "Head of Sales Development", "Head of Growth", "VP Business Development", "Head of Sales", "Director of Sales", "Director of Business Development"],
    seniorityFloor: "DIRECTOR",
  }),
  size: defaultSize({ minEmployees: 3, excludeTooSmall: true }),
  disqualifiers: {
    genericEmailContact: { disqualify: true },
    onePersonCompany: { disqualify: true, threshold: 3 },
    websiteOffline: { disqualify: true },
  },
  requiredEvidence: { employeeSize: true, websiteReachable: true },
});

export const TELESTAR_DESIGN = defineIcp({
  ruleSetId: "corpus-07-telestar-design",
  displayName: "TeleStar for Design",
  geography: defaultGeography({
    targetCountries: ["Singapore", "Malaysia", "Australia", "Israel", "Canada", "Japan"],
    targetRegions: ["EU"],
  }),
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["ADVERTISING", "MARKETING", "MEDIA", "SOFTWARE"] }),
  persona: defaultPersona({
    titleAllowlist: ["CEO", "COO", "Head of Operations", "Director of Operations", "Head of HR", "HR Director", "Creative Director", "Marketing Director"],
  }),
  size: defaultSize({ sizeBands: ["SMALL", "MEDIUM"] }),
});

export const CYBERSTASH = defineIcp({
  ruleSetId: "corpus-08-cyberstash",
  displayName: "Cyberstash — cybersecurity",
  geography: defaultGeography({
    targetCountries: ["New Zealand", "Australia", "Singapore", "Malaysia"],
    targetRegions: ["ANZ", "APAC", "SEA"],
  }),
  persona: defaultPersona({ titleKeywords: ["it", "cto", "cro", "ciso", "soc", "cio", "security", "risk", "msp"] }),
  size: defaultSize({ minEmployees: 25, maxEmployees: 500 }),
});

export const ALISON = defineIcp({
  ruleSetId: "corpus-09-alison",
  displayName: "Alison — online courses",
  geography: defaultGeography({ targetRegions: ["NORTH_AMERICA"], excludedCountries: ["India"] }),
  persona: defaultPersona({
    titleTiers: [
      { tier: 1, titles: ["CMO", "CEO", "Founder"], keywords: ["marketing", "creative"], weight: 100 },
      { tier: 2, titles: [], keywords: ["performance", "user acquisition", "growth", "advertising", "analytics", "media"], weight: 60 },
    ],
    titleDenylist: ["associate", "assistant", "product marketing", "direct marketing", "event marketing", "email marketing", "lifecycle", "crm marketing", "marketing operations", "content marketing", "manager"],
  }),
  disqualifiers: { competitorDenylist: ["Google", "Meta", "TikTok"] },
});

export const CLOUDIAN = defineIcp({
  ruleSetId: "corpus-10-cloudian",
  displayName: "Cloudian — data / cloud storage (Vietnam)",
  geography: defaultGeography({ targetCountries: ["Vietnam"] }),
  industry: defaultIndustry({
    mode: "allowlist",
    targetIndustries: ["BANKING", "FINANCE", "INSURANCE", "GOVERNMENT", "MANUFACTURING", "MEDIA", "EDUCATION"],
  }),
  persona: defaultPersona({ titleKeywords: ["ceo", "founder", "cto", "cio", "it", "infrastructure", "cloud", "cybersecurity", "data", "ciso", "storage", "backup"] }),
  size: defaultSize({ sizeBands: ["MID_MARKET", "ENTERPRISE", "LARGE_ENTERPRISE"] }),
});

export const FLEXENERGY = defineIcp({
  ruleSetId: "corpus-11-flexenergy",
  displayName: "FlexEnergy — utility / electricity distribution",
  geography: defaultGeography({
    targetCountries: ["Switzerland"],
    targetRegions: ["GERMAN_SPEAKING"],
    subNationalRegions: ["German-speaking Switzerland"],
  }),
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["UTILITY"], industryKeywords: ["electricity distribution"], subIndustries: ["electricity distribution"] }),
  persona: defaultPersona({
    titleAllowlist: ["Direktor", "Mitglied der Geschäftsleitung", "Digital Manager", "Innovation Manager", "Produktmanager", "Leiter Inkasso"],
    languageVariants: { de: ["Direktor", "Leiter Inkasso", "Produktmanager"] },
  }),
  accountSupplied: { mode: "preapproved_skip", companyList: ["ewz.ch", "bkw.ch"] },
});

export const COREAI = defineIcp({
  ruleSetId: "corpus-12-coreai",
  displayName: "CoreAI — project-based IT/software",
  geography: defaultGeography({ targetCountries: ["Japan", "Singapore", "Hong Kong", "Switzerland", "Germany", "United Arab Emirates"] }),
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["IT_SERVICES", "SOFTWARE"] }),
  persona: defaultPersona({
    titleKeywords: ["ceo", "coo", "cto", "partnerships"],
    titleDenylist: ["technical lead", "owner"],
    seniorityExclusions: ["OWNER"],
  }),
  size: defaultSize({ minEmployees: 20 }),
});

export const CHAINWIRE = defineIcp({
  ruleSetId: "corpus-13-chainwire",
  displayName: "Chainwire — crypto + cyber sub-ICPs",
  geography: defaultGeography({ targetCountries: ["United States"] }),
  persona: defaultPersona({ titleKeywords: ["marketing", "content", "community", "branding", "pr", "communications"] }),
  subIcps: [
    {
      id: "crypto",
      label: "Crypto market",
      keywords: ["crypto", "cryptocurrency", "nft", "defi", "gamefi", "digital assets", "web3"],
      industry: { mode: "denylist", excludedIndustries: ["MARKETING", "MEDIA", "HOSPITALITY", "INSURANCE", "EDUCATION"] },
    },
    {
      id: "cyber",
      label: "Cyber market",
      keywords: ["cyber", "security", "devops", "ai", "ddos", "antivirus"],
      geography: { targetRegions: ["APAC", "SOUTH_AMERICA"] },
      industry: { mode: "allowlist", targetIndustries: ["CYBERSECURITY"], excludedIndustries: ["MEDIA", "HEALTHCARE", "LOGISTICS"] },
      size: { sizeBands: ["MEDIUM", "MID_MARKET", "ENTERPRISE"], unknownSizePolicy: "review_required" },
    },
  ],
});

export const ONE_C = defineIcp({
  ruleSetId: "corpus-14-1c",
  displayName: "1C — business solutions (per-product personas)",
  persona: defaultPersona({ titleKeywords: ["it manager", "it director", "ceo", "coo", "cfo", "cmo", "cto", "chief accountant"] }),
  subIcps: [
    { id: "dms", label: "1C:Document Management", keywords: ["document management"], persona: { titleKeywords: ["it manager", "it director", "ceo", "coo", "cco", "cfo", "cmo", "cto"] } },
    { id: "company-mgmt", label: "1C:Company Management", keywords: ["mini erp", "company management"], persona: { titleKeywords: ["sales", "procurement", "manufacturing", "it manager", "chief accountant"] } },
    { id: "erp", label: "1C:ERP", keywords: ["erp", "group"], size: { sizeBands: ["MID_MARKET", "ENTERPRISE", "LARGE_ENTERPRISE"], minEmployees: 200, unknownSizePolicy: "review_required" } },
  ],
});

export const COSMOSE = defineIcp({
  ruleSetId: "corpus-15-cosmose",
  displayName: "Cosmose — AI shopping / media",
  geography: defaultGeography({ targetCountries: ["Mexico", "Spain", "Chile"] }),
  persona: defaultPersona({
    titleTiers: [
      { tier: 1, titles: [], keywords: ["partnership", "vp", "editor", "content"], weight: 100 },
      { tier: 2, titles: [], keywords: ["sales", "bd", "ceo", "managing director", "coo"], weight: 60 },
    ],
    titleKeywords: ["media", "publisher", "content creator", "founder"],
  }),
});

export const BIZITRIP = defineIcp({
  ruleSetId: "corpus-16-bizitrip",
  displayName: "BiziTrip — corporate travel/mobility",
  geography: defaultGeography({ targetCountries: ["Vietnam"] }),
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["IT_SERVICES", "SOFTWARE", "LOGISTICS", "FINANCE", "MANUFACTURING", "TRANSPORTATION"] }),
  persona: defaultPersona({
    titleAllowlist: ["CEO", "CFO", "Director", "HR", "Admin"],
    // HR/Admin: any level OK (non-manager allowed).
    departmentSeniorityOverrides: { HR: "IC", ADMIN: "IC" },
    seniorityFloor: "DIRECTOR",
  }),
  size: defaultSize({ minEmployees: 50 }),
});

export const ANTSOMI = defineIcp({
  ruleSetId: "corpus-17-antsomi",
  displayName: "Antsomi — CDP",
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["RETAIL", "ECOMMERCE"], industryKeywords: ["growth marketing", "retail"] }),
  persona: defaultPersona({
    titleKeywords: ["cmo", "retail director", "retail head", "growth marketing", "omnichannel"],
    titleDenylist: ["design", "designer"],
  }),
  // revenue >$1M OR size >50
  size: defaultSize({ minEmployees: 50, minRevenueUsd: 1_000_000 }),
});

export const CAMELO = defineIcp({
  ruleSetId: "corpus-18-camelo",
  displayName: "Camelo — shift / workforce scheduling",
  geography: defaultGeography({ targetRegions: ["APAC"] }),
  industry: defaultIndustry({ mode: "allowlist", targetIndustries: ["HOSPITALITY", "RETAIL", "HEALTHCARE", "LOGISTICS", "MANUFACTURING"] }),
  persona: defaultPersona({
    titleAllowlist: ["Owner", "CEO", "COO", "HR Manager", "Operations Manager", "Workforce Manager", "Staffing Manager", "Store Manager", "Restaurant Manager"],
  }),
  size: defaultSize({ sizeBands: ["SMALL", "MEDIUM", "MID_MARKET", "ENTERPRISE", "LARGE_ENTERPRISE"], multiLocationOk: true }),
});

export const ICP_CORPUS: readonly IcpVersionRulesV2[] = [
  STORMWALL,
  ONECLOUDHUB,
  SAIGON_TECH,
  DPOINT,
  STS,
  TELESTAR,
  TELESTAR_DESIGN,
  CYBERSTASH,
  ALISON,
  CLOUDIAN,
  FLEXENERGY,
  COREAI,
  CHAINWIRE,
  ONE_C,
  COSMOSE,
  BIZITRIP,
  ANTSOMI,
  CAMELO,
];
