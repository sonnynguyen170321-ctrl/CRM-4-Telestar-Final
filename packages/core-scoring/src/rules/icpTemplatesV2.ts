import { emptyIcpRulesV2 } from "./emptyIcpRulesV2";
import type { IcpVersionRulesV2 } from "./schema-v2";

// Prebuilt schema-v2 ICP presets — a "start from template" library for the ICP editor so a
// new draft ships with sensible target industries, buyer personas (title-tiers + seniority),
// size bands, and weights instead of an empty shell. Each is a structurally valid
// IcpVersionRulesV2 (validated by test via validateIcpVersionRulesV2). Deterministic; no AI.

export type IcpTemplate = {
  id: string;
  name: string;
  description: string;
  build: (ruleSetId: string) => IcpVersionRulesV2;
};

// Common decision-maker title tiers, reused across templates (tier 1 = strongest fit).
// Exported because it is also the repair ladder for ICP versions that were published with no
// persona constraint at all: with an empty persona, `personaScore` returns a flat 60 for every
// contact holding any title, so the dimension stops separating leads entirely.
export function execTiers(extraTitles: string[]): IcpVersionRulesV2["persona"]["titleTiers"] {
  return [
    { tier: 1, titles: ["ceo", "founder", "co-founder", "owner", "president"], keywords: [], weight: 100 },
    { tier: 2, titles: ["cto", "cio", "cmo", "cfo", "coo", "cro", "chief"], keywords: [], weight: 95 },
    { tier: 3, titles: ["vp", "vice president", "head of", "director"], keywords: extraTitles, weight: 80 },
    { tier: 4, titles: ["manager", "lead"], keywords: [], weight: 55 },
  ];
}

function base(
  ruleSetId: string,
  name: string,
  overrides: {
    industries: string[];
    industryKeywords: string[];
    personaTitleKeywords: string[];
    personaExtraTierTitles?: string[];
    sizeBands: IcpVersionRulesV2["size"]["sizeBands"];
    departmentAllowlist?: IcpVersionRulesV2["persona"]["departmentAllowlist"];
  }
): IcpVersionRulesV2 {
  const rules = emptyIcpRulesV2(ruleSetId, name);
  rules.industry = {
    ...rules.industry,
    // "all" = permissive default (won't hard-exclude off-target industries); the target
    // industries + keywords still drive the graduated industry sub-score. Tighten to
    // "allowlist" in the editor to make industry a hard filter.
    mode: "all",
    targetIndustries: overrides.industries,
    industryKeywords: overrides.industryKeywords,
  };
  rules.persona = {
    ...rules.persona,
    titleTiers: execTiers(overrides.personaExtraTierTitles ?? []),
    titleKeywords: overrides.personaTitleKeywords,
    departmentAllowlist: overrides.departmentAllowlist ?? [],
    requirePersonaForFinalQualification: true,
  };
  rules.size = { ...rules.size, sizeBands: overrides.sizeBands };
  rules.requiredEvidenceForFinalQualification = {
    ...rules.requiredEvidenceForFinalQualification,
    personaTitle: true,
  };
  return rules;
}

export const ICP_TEMPLATES_V2: IcpTemplate[] = [
  {
    id: "b2b_saas_midmarket",
    name: "B2B SaaS — Mid-market",
    description: "Software platforms selling to mid-market teams; RevOps/Ops buyers.",
    build: (id) =>
      base(id, "B2B SaaS — Mid-market", {
        industries: ["software", "saas", "technology"],
        industryKeywords: ["saas", "platform", "software", "cloud"],
        personaTitleKeywords: ["revops", "operations", "growth", "sales"],
        sizeBands: ["MEDIUM", "MID_MARKET"],
      }),
  },
  {
    id: "ecommerce_saas",
    name: "Ecommerce SaaS",
    description: "Tools for online/DTC brands; ecommerce & marketing owners.",
    build: (id) =>
      base(id, "Ecommerce SaaS", {
        industries: ["ecommerce", "retail", "consumer"],
        industryKeywords: ["shopify", "ecommerce", "dtc", "merchants", "retail"],
        personaTitleKeywords: ["ecommerce", "marketing", "growth", "digital"],
        sizeBands: ["SMALL", "MEDIUM", "MID_MARKET"],
      }),
  },
  {
    id: "fintech_payments",
    name: "Fintech / Payments",
    description: "Payments & billing infrastructure buyers in finance/product.",
    build: (id) =>
      base(id, "Fintech / Payments", {
        industries: ["fintech", "financial services", "payments"],
        industryKeywords: ["payments", "checkout", "billing", "fintech", "banking"],
        personaTitleKeywords: ["payments", "finance", "product", "treasury"],
        sizeBands: ["MID_MARKET", "ENTERPRISE"],
      }),
  },
  {
    id: "cybersecurity",
    name: "Cybersecurity",
    description: "Security software buyers: CISO/security/IT.",
    build: (id) =>
      base(id, "Cybersecurity", {
        industries: ["cybersecurity", "security", "technology"],
        industryKeywords: ["security", "soc", "siem", "threat", "cyber"],
        personaTitleKeywords: ["security", "ciso", "infosec", "it"],
        personaExtraTierTitles: ["ciso", "security"],
        sizeBands: ["MID_MARKET", "ENTERPRISE", "LARGE_ENTERPRISE"],
      }),
  },
  {
    id: "logistics",
    name: "Logistics / Supply chain",
    description: "Freight, 3PL, supply-chain; ops/procurement buyers.",
    build: (id) =>
      base(id, "Logistics / Supply chain", {
        industries: ["logistics", "transportation", "supply chain"],
        industryKeywords: ["logistics", "freight", "3pl", "supply chain", "shipping"],
        personaTitleKeywords: ["supply chain", "logistics", "procurement", "operations"],
        sizeBands: ["MEDIUM", "MID_MARKET", "ENTERPRISE"],
      }),
  },
  {
    id: "agency_msp",
    name: "Agency / MSP",
    description: "Marketing agencies & managed-service providers; owner/ops buyers.",
    build: (id) =>
      base(id, "Agency / MSP", {
        industries: ["agency", "services", "consulting"],
        industryKeywords: ["agency", "msp", "managed services", "consulting", "it services"],
        personaTitleKeywords: ["owner", "operations", "delivery", "account"],
        sizeBands: ["MICRO", "SMALL", "MEDIUM"],
      }),
  },
  {
    id: "manufacturing",
    name: "Manufacturing / Industrial",
    description: "Manufacturers & industrial; procurement/operations buyers.",
    build: (id) =>
      base(id, "Manufacturing / Industrial", {
        industries: ["manufacturing", "industrial"],
        industryKeywords: ["manufacturing", "factory", "industrial", "production", "erp"],
        personaTitleKeywords: ["procurement", "operations", "plant", "supply chain"],
        sizeBands: ["MID_MARKET", "ENTERPRISE", "LARGE_ENTERPRISE"],
      }),
  },
  {
    id: "devtools",
    name: "Developer tools",
    description: "API/dev platforms; engineering & platform buyers.",
    build: (id) =>
      base(id, "Developer tools", {
        industries: ["software", "developer tools", "technology"],
        industryKeywords: ["developer", "api", "sdk", "devops", "platform"],
        personaTitleKeywords: ["engineering", "platform", "developer", "devops"],
        personaExtraTierTitles: ["vp engineering", "head of platform"],
        sizeBands: ["SMALL", "MEDIUM", "MID_MARKET"],
      }),
  },
];

export function getIcpTemplateV2(id: string): IcpTemplate | null {
  return ICP_TEMPLATES_V2.find((t) => t.id === id) ?? null;
}
