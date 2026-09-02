import type { DimensionKey, RawScoringEvidence } from "../../rules/evidence";
import type { IcpVersionRulesV2 } from "../../rules/schema-v2";
import {
  ALISON,
  ANTSOMI,
  BIZITRIP,
  CAMELO,
  ONECLOUDHUB,
  STORMWALL,
  STS,
  TELESTAR,
} from "./index";

// Golden company/contact fixtures + expected gate/dimension outcomes for the hard
// mechanisms in the corpus. SC2 asserts gates + per-dimension subScores +
// missingEvidence (the 4-state qualification derivation is SC3). Fixture-only.

export type GoldenExpectation = {
  disqualified?: boolean;
  gateIdsInclude?: string[];
  subScoreAtLeast?: Partial<Record<DimensionKey, number>>;
  subScoreAtMost?: Partial<Record<DimensionKey, number>>;
  missingEvidenceInclude?: string[];
};

export type GoldenCase = {
  name: string;
  icp: IcpVersionRulesV2;
  evidence: RawScoringEvidence;
  expect: GoldenExpectation;
};

const saasProductCompany = (over: Partial<RawScoringEvidence["company"]> = {}) => ({
  companyName: "Northstar Labs",
  domain: "northstar.io",
  country: "United States",
  industry: "B2B SaaS",
  employeeCount: 80,
  companyType: "PRODUCT_SAAS" as const,
  websiteStatus: "reachable" as const,
  evidenceText: "B2B SaaS platform software product",
  ...over,
});

export const GOLDEN_CASES: readonly GoldenCase[] = [
  // --- TeleStar: clean fit ---
  {
    name: "TeleStar clean fit (US SaaS, director, company email)",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany(),
      contact: { rawTitle: "Director of Sales", email: "jane@northstar.io" },
    },
    expect: {
      disqualified: false,
      subScoreAtLeast: { geo: 100, companyType: 100, persona: 100, size: 100 },
    },
  },
  // --- TeleStar: gmail terminal disqualifier ---
  {
    name: "TeleStar gmail contact -> generic_email gate",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany(),
      contact: { rawTitle: "Director of Sales", email: "jane.doe@gmail.com" },
    },
    expect: { disqualified: true, gateIdsInclude: ["generic_email_contact"] },
  },
  // --- TeleStar: office in India terminal (office-location != HQ) ---
  {
    name: "TeleStar office in India -> excluded_office gate",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany({ country: "Australia", officeCountries: ["India"] }),
      contact: { rawTitle: "CEO", email: "ceo@northstar.io" },
    },
    expect: { disqualified: true, gateIdsInclude: ["excluded_office_country"] },
  },
  // --- TeleStar: one-person terminal ---
  {
    name: "TeleStar one-person company -> one_person gate",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany({ employeeCount: 1 }),
      contact: { rawTitle: "Founder", email: "f@northstar.io" },
    },
    expect: { disqualified: true, gateIdsInclude: ["one_person_company"] },
  },
  // --- TeleStar: services/consulting terminal (non-VN) ---
  {
    name: "TeleStar US services company -> services gate",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany({ companyType: "SERVICE_ONLY", evidenceText: "consulting and outsourcing agency" }),
      contact: { rawTitle: "CEO", email: "ceo@northstar.io" },
    },
    expect: { disqualified: true, gateIdsInclude: ["services_consulting_based"] },
  },
  // --- TeleStar: services/consulting allowed in Vietnam (conditional exception) ---
  {
    name: "TeleStar Vietnam services company -> exception, no services gate",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany({ country: "Vietnam", companyType: "SERVICE_ONLY", evidenceText: "consulting and outsourcing services" }),
      contact: { rawTitle: "CEO", email: "ceo@northstar.io" },
    },
    expect: { disqualified: false },
  },
  // --- TeleStar: company fits, persona missing ---
  {
    name: "TeleStar no contact -> persona missing required",
    icp: TELESTAR,
    evidence: { company: saasProductCompany() },
    expect: {
      disqualified: false,
      subScoreAtMost: { persona: 0 },
      missingEvidenceInclude: ["target_persona_missing_required"],
    },
  },
  // --- Alison: persona denylist ("no manager") ---
  {
    name: "Alison Marketing Manager -> persona denylisted",
    icp: ALISON,
    evidence: {
      company: { companyName: "EdReach", country: "United States", industry: "Education" },
      contact: { rawTitle: "Marketing Manager", email: "m@edreach.com" },
    },
    expect: { disqualified: false, subScoreAtMost: { persona: 0 } },
  },
  // --- Alison: competitor denylist ---
  {
    name: "Alison Google -> competitor denylist gate",
    icp: ALISON,
    evidence: {
      company: { companyName: "Google", domain: "google.com", country: "United States" },
      contact: { rawTitle: "CMO", email: "cmo@google.com" },
    },
    expect: { disqualified: true, gateIdsInclude: ["competitor_denylisted"] },
  },
  // --- Alison: India excluded ---
  {
    name: "Alison India -> excluded_country gate",
    icp: ALISON,
    evidence: {
      company: { companyName: "EduIndia", country: "India" },
      contact: { rawTitle: "CMO", email: "cmo@eduindia.in" },
    },
    expect: { disqualified: true, gateIdsInclude: ["excluded_country"] },
  },
  // --- 1CloudHub: "no engineer" denylist ---
  {
    name: "1CloudHub Software Engineer -> persona denylisted",
    icp: ONECLOUDHUB,
    evidence: {
      company: { companyName: "SgTech", country: "Singapore" },
      contact: { rawTitle: "Software Engineer", email: "e@sgtech.sg" },
    },
    expect: { subScoreAtMost: { persona: 0 } },
  },
  // --- STS: factory in Vietnam satisfies required office ---
  {
    name: "STS factory in Vietnam -> required office present",
    icp: STS,
    evidence: {
      company: { companyName: "FurniCorp", country: "United States", officeCountries: ["Vietnam"], industry: "Furniture manufacturing", employeeCount: 120 },
      contact: { rawTitle: "Factory Director", email: "fd@furnicorp.com" },
    },
    expect: { subScoreAtLeast: { geo: 70, persona: 100 } },
  },
  {
    name: "STS no Vietnam office -> geo capped + required office missing",
    icp: STS,
    evidence: {
      company: { companyName: "FurniUS", country: "United States", industry: "Furniture manufacturing", employeeCount: 120 },
      contact: { rawTitle: "Factory Director", email: "fd@furnius.com" },
    },
    expect: { subScoreAtMost: { geo: 30 }, missingEvidenceInclude: ["required_office_missing"] },
  },
  // --- Stormwall: India is a TARGET (geo inversion vs TeleStar) ---
  {
    name: "Stormwall India -> geo target match (not excluded)",
    icp: STORMWALL,
    evidence: {
      company: { companyName: "IndNet ISP", country: "India", industry: "ISP telecom", employeeCount: 400 },
      contact: { rawTitle: "CISO", email: "ciso@indnet.in" },
    },
    expect: { disqualified: false, subScoreAtLeast: { geo: 100, persona: 100 } },
  },
  // --- BiziTrip: HR IC allowed via department override ---
  {
    name: "BiziTrip HR Executive (IC) -> not floored by department override",
    icp: BIZITRIP,
    evidence: {
      company: { companyName: "VietLog", country: "Vietnam", industry: "Logistics", employeeCount: 200 },
      contact: { rawTitle: "HR Executive", email: "hr@vietlog.vn" },
    },
    expect: { subScoreAtLeast: { persona: 100 } },
  },
  // --- Antsomi: revenue satisfies size even below headcount floor ---
  {
    name: "Antsomi revenue >$1M satisfies size despite small headcount",
    icp: ANTSOMI,
    evidence: {
      company: { companyName: "ShopGrow", country: "Vietnam", industry: "E-commerce retail", employeeCount: 20, revenueUsd: 2_000_000 },
      contact: { rawTitle: "CMO", email: "cmo@shopgrow.vn" },
    },
    expect: { subScoreAtLeast: { size: 100 } },
  },
  // --- Camelo: multi-location satisfies size when headcount unknown ---
  {
    name: "Camelo multi-location -> size satisfied via locations",
    icp: CAMELO,
    evidence: {
      company: { companyName: "CafeChain", country: "Australia", industry: "Hospitality restaurant", locationCount: 12 },
      contact: { rawTitle: "Operations Manager", email: "ops@cafechain.au" },
    },
    expect: { subScoreAtLeast: { size: 100, persona: 100 } },
  },
];
