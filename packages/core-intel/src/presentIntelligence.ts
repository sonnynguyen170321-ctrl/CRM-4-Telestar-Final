import type { CompanyIntelligenceProfileSummary } from "./profileSummary";
import type { CompanyIntelligenceReasoning } from "./reasoning/contract";
import {
  CATEGORY_PREFERRED_SECTORS,
  classifyServedVerticals,
  formatIndustryDetail,
} from "@telestar/core-scoring/rules/dictionaries/servedVertical";

// CINT5: the SINGLE shared presenter. Maps a persisted intelligence profile (JSON
// columns) into one identity-first view consumed by every surface (Company drawer,
// Lead drawer, Manager Review, Compose) so they never drift. Pure, tolerant parsing
// — real persisted data only; nothing is invented. classificationJson holds the full
// reasoning contract under .reasoning (schemaVersion v2.company-intelligence.reasoning.v1).

export type IntelligenceConfidence = "HIGH" | "MEDIUM" | "LOW";

export type IntelligenceEvidenceLine = { text: string; url: string; pageType: string; provider: string | null };

// A claim + its grounding, unlocked from the persisted reasoning contract (previously the
// per-claim citations and per-field confidence were dropped by this presenter).
export type CitedClaim = {
  label: string;
  value: string;
  confidence: IntelligenceConfidence | null;
  citations: IntelligenceEvidenceLine[];
};

export type IntelligenceFootprint = {
  hqCountries: string[];
  officeCountries: string[];
  factoryCountries: string[];
  marketCountries: string[];
  revenueUsd: number | null;
  locationCount: number | null;
  multiLocation: boolean;
  recentNews: boolean;
};

export type IntelligenceQuality = {
  usefulPages: number | null;
  uniqueSources: number | null;
  score: number | null;
  conflicts: string[];
};

export type IntelligencePartnership = { name: string; kind: string; confidence: IntelligenceConfidence | null };

export type IntelligenceView = {
  available: boolean;
  companySummary: string | null;
  offeringType: string | null;
  vertical: string | null;
  category: string | null;
  /** W5: deterministic "Category · Vertical" label (e.g. "SaaS · FinTech", "Manufacturing · Wool"). */
  industryDetail: string | null;
  servedVerticals: Array<{ key: string; label: string; parentLabel: string | null }>;
  confidence: IntelligenceConfidence | null;
  whatTheySell: string[];
  businessModel: string | null;
  channels: string[];
  likelyBuyers: string[];
  companySize: { level: string | null; employees: number | null } | null;
  targetMarket: string[];
  growth: { hiringReal: boolean; signals: Array<{ kind: string; detail: string }> };
  partnerships: Array<{ name: string; kind: string }>;
  maturity: { customers: boolean; partnerships: boolean; funding: boolean; hiring: boolean };
  evidence: IntelligenceEvidenceLine[];
  // ── Depth unlock (all persisted; previously never surfaced) ──
  claims: CitedClaim[]; // offering / model / channels / hiring with citations + confidence
  growthSignalsCited: Array<{ kind: string; detail: string; confidence: IntelligenceConfidence | null; citations: IntelligenceEvidenceLine[] }>;
  partnershipsCited: IntelligencePartnership[];
  footprint: IntelligenceFootprint;
  risks: string[];
  quality: IntelligenceQuality | null;
  confidenceReasons: string[];
  providerAttempts: Array<{ provider: string; status: string; usableCount: number | null }>;
  debug: {
    engine: string | null;
    llmUsed: boolean;
    providerUsed: string | null;
    pagesFetched: number | null;
    searchSufficient: boolean | null;
    fetchStatus: string | null;
  };
  profileStatus: string | null;
  staleAt: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  // Real-economy archetypes
  food_beverage: "Food & beverage producer",
  cpg_consumer_goods: "Consumer packaged goods / brand",
  retail_distribution: "Retail & distribution",
  agriculture_commodities: "Agriculture & commodities",
  manufacturing: "Manufacturing / industrial products",
  logistics: "Freight forwarding and logistics",
  energy: "Energy / utilities",
  agency: "Agency / consulting / services",
  // Tech / software archetypes
  ecommerce_saas: "SaaS for ecommerce",
  customer_intel: "Customer intelligence / personalization",
  crm_martech: "CRM / marketing automation",
  data_analytics: "Data / analytics platform",
  ai_automation: "AI / automation software",
  cybersecurity: "Cybersecurity software",
  hr_recruiting: "HR / recruiting software",
  fintech: "Fintech / financial software",
  education: "Education / e-learning",
  healthtech: "Healthcare / healthtech",
  b2b_saas: "B2B SaaS / software platform",
  devtools: "Developer tools / API platform",
  fintech_payments: "Fintech / payments",
  fintech_lending: "Fintech / lending & credit",
  legaltech: "Legaltech",
  proptech: "Proptech / real estate",
  hardware_iot: "Hardware / IoT",
  marketplace: "Marketplace",
  msp: "MSP / IT services",
  hospitality_travel: "Hospitality / travel",
};

const BUYERS_BY_CATEGORY: Record<string, string[]> = {
  // Real-economy archetypes
  food_beverage: ["Sales", "Trade marketing", "Distribution", "Supply chain"],
  cpg_consumer_goods: ["Sales", "Trade marketing", "Brand", "Category management"],
  retail_distribution: ["Merchandising", "Operations", "Procurement", "Supply chain"],
  agriculture_commodities: ["Procurement", "Export sales", "Operations"],
  agency: ["Marketing", "Operations", "Leadership"],
  education: ["L&D", "Academic", "Operations"],
  b2b_saas: ["Operations", "IT", "RevOps"],
  // Tech / software archetypes
  ecommerce_saas: ["Ecommerce / DTC ops", "Marketing", "Growth"],
  customer_intel: ["Marketing", "CRM", "Growth"],
  crm_martech: ["Sales", "Marketing", "RevOps"],
  data_analytics: ["Data", "Analytics", "Engineering"],
  ai_automation: ["Engineering", "Operations"],
  cybersecurity: ["Security", "IT"],
  hr_recruiting: ["HR", "Talent"],
  fintech: ["Finance", "Operations"],
  logistics: ["Supply chain", "Procurement", "Import-export"],
  manufacturing: ["Procurement", "Operations"],
  healthtech: ["Clinical", "Operations"],
  devtools: ["Engineering", "Platform", "DevOps"],
  fintech_payments: ["Finance", "Payments", "Product"],
  fintech_lending: ["Risk", "Credit", "Finance"],
  legaltech: ["Legal", "Compliance", "Operations"],
  proptech: ["Real estate", "Operations", "Facilities"],
  hardware_iot: ["Engineering", "Operations", "Product"],
  marketplace: ["Operations", "Growth", "Category managers"],
  msp: ["IT", "Operations"],
  hospitality_travel: ["Operations", "Revenue management"],
  energy: ["Operations", "Sustainability", "Facilities"],
};

// Re-exported for the surfaces that already import it from here. The table itself lives beside
// `classifyServedVerticals` so the scoring path can use the same tie-break — it previously could not,
// which is why a food producer scored with an INDUSTRIAL vertical token while the drawer showed
// "Food & Beverage".
export { CATEGORY_PREFERRED_SECTORS };

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function bool(value: unknown): boolean {
  return value === true;
}

function readReasoning(classification: unknown): CompanyIntelligenceReasoning | null {
  const c = obj(classification);
  const reasoning = c.reasoning;
  return reasoning && typeof reasoning === "object" ? (reasoning as CompanyIntelligenceReasoning) : null;
}

function categoryToken(facts: string[]): string | null {
  const t = facts.find((f) => f.startsWith("category."));
  return t ? t.slice("category.".length) : null;
}

// Company size LEVEL from a real headcount (startup/small/medium/large/enterprise) —
// the count is the single source of truth, so it can never read "small" for a
// 354-person firm. Falls back to the count-derived band token when no raw count.
const SIZE_BAND_LEVEL: Record<string, string> = {
  SMALL: "Small", MEDIUM: "Medium", MID_MARKET: "Large", ENTERPRISE: "Enterprise", LARGE_ENTERPRISE: "Enterprise",
};
function sizeLevelFromCount(n: number): string {
  if (n <= 10) return "Startup";
  if (n <= 50) return "Small";
  if (n <= 250) return "Medium";
  if (n <= 1000) return "Large";
  return "Enterprise";
}
function deriveCompanySize(facts: string[]): IntelligenceView["companySize"] {
  const countTok = facts.find((f) => f.startsWith("size.employee_count_"));
  if (countTok) {
    const employees = Number(countTok.slice("size.employee_count_".length));
    if (Number.isFinite(employees) && employees > 0) {
      return { level: sizeLevelFromCount(employees), employees };
    }
  }
  const bandTok = facts.find((f) => f.startsWith("size.range_"));
  if (bandTok) {
    return { level: SIZE_BAND_LEVEL[bandTok.slice("size.range_".length)] ?? null, employees: null };
  }
  return null;
}

const MARKET_SEGMENT_LABEL: Record<string, string> = { smb: "SMB", mid_market: "Mid-market" };
function deriveTargetMarket(facts: string[]): string[] {
  const out: string[] = [];
  for (const f of facts) {
    if (!f.startsWith("market.segment_")) continue;
    const seg = f.slice("market.segment_".length);
    const label = MARKET_SEGMENT_LABEL[seg] ?? seg.replace(/_/g, " ");
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export function presentCompanyIntelligence(
  profile: CompanyIntelligenceProfileSummary | null
): IntelligenceView {
  if (!profile) return emptyView();

  const reasoning = readReasoning(profile.classification);
  const facts = profile.facts ?? [];
  const confidenceObj = obj(profile.confidence);
  const coverage = obj(profile.sourceCoverage);

  const catId = categoryToken(facts);
  const offering = reasoning?.offering.value;
  const channels = reasoning?.channels.value ?? [];
  const partnerships = (reasoning?.partnerships ?? []).map((p) => ({ name: p.name, kind: p.kind }));
  const signals = (reasoning?.growth.signals ?? []).map((s) => ({ kind: s.kind, detail: s.detail }));

  const whatTheySell = dedupe([
    offering?.primaryOffering ?? null,
    ...(facts.filter((f) => f.startsWith("offering.")).map((f) => labelOffering(f))),
  ]);

  const confidence = normalizeConfidence(
    str(confidenceObj.overallConfidence) ?? (reasoning?.overallConfidence ?? null)
  );

  const evidence: IntelligenceEvidenceLine[] = (profile.evidenceItems ?? [])
    .filter((e) => e.evidenceText && e.sourceUrl)
    .slice(0, 6)
    .map((e) => ({ text: e.evidenceText, url: e.sourceUrl, pageType: e.pageType ?? e.family ?? "", provider: e.provider ?? null }));

  const engineTrace = obj(confidenceObj.engineTrace);

  // ── Depth unlock: per-claim citations + confidence (from the reasoning contract) ──
  const cite = (refs: Array<{ url: string; text: string; pageType: string; provider?: string | null }> | undefined): IntelligenceEvidenceLine[] =>
    (refs ?? []).slice(0, 4).map((r) => ({ text: r.text, url: r.url, pageType: r.pageType, provider: r.provider ?? null }));

  const claims: CitedClaim[] = [];
  if (reasoning) {
    if (offering && offering.type !== "unknown") {
      claims.push({
        label: "What they sell",
        value: offering.primaryOffering || labelOfferingType(offering.type),
        confidence: normalizeConfidence(reasoning.offering.confidence),
        citations: cite(reasoning.offering.evidence),
      });
    }
    if (reasoning.businessModel.value.model !== "unknown") {
      claims.push({
        label: "Business model",
        value: `${reasoning.businessModel.value.model}${reasoning.businessModel.value.pricingModel ? ` · ${reasoning.businessModel.value.pricingModel}` : ""}`,
        confidence: normalizeConfidence(reasoning.businessModel.confidence),
        citations: cite(reasoning.businessModel.evidence),
      });
    }
    if ((reasoning.channels.value ?? []).length > 0) {
      claims.push({
        label: "Sales channels",
        value: reasoning.channels.value.join(", "),
        confidence: normalizeConfidence(reasoning.channels.confidence),
        citations: cite(reasoning.channels.evidence),
      });
    }
    if (reasoning.growth.hiring.evidence.length > 0) {
      claims.push({
        label: "Hiring",
        value: reasoning.growth.hiring.value.real ? "Actively hiring (real roles)" : "No real hiring detected",
        confidence: normalizeConfidence(reasoning.growth.hiring.confidence),
        citations: cite(reasoning.growth.hiring.evidence),
      });
    }
  }

  const growthSignalsCited = (reasoning?.growth.signals ?? []).map((s) => ({
    kind: s.kind,
    detail: s.detail,
    confidence: normalizeConfidence(s.confidence),
    citations: cite(s.evidence),
  }));

  const partnershipsCited: IntelligencePartnership[] = (reasoning?.partnerships ?? []).map((p) => ({
    name: p.name,
    kind: p.kind,
    confidence: normalizeConfidence(p.confidence),
  }));

  // Footprint from fact tokens that never rendered before (geo/revenue/location/news).
  const geoOf = (prefix: string) =>
    dedupe(facts.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length).replace(/_/g, " ")));
  const revenueTok = facts.find((f) => f.startsWith("revenue.usd_"));
  const locationTok = facts.find((f) => f.startsWith("location.count_"));
  const footprint: IntelligenceFootprint = {
    hqCountries: geoOf("geo.hq_country_"),
    officeCountries: geoOf("geo.office_country_"),
    factoryCountries: geoOf("geo.factory_country_"),
    marketCountries: geoOf("geo.market_"),
    revenueUsd: revenueTok ? Number(revenueTok.slice("revenue.usd_".length)) || null : null,
    locationCount: locationTok ? Number(locationTok.slice("location.count_".length)) || null : null,
    multiLocation: facts.includes("location.multi_location"),
    recentNews: facts.includes("news.recent"),
  };

  // Risks: riskSignalsJson (previously dead to the UI) + risk.* fact tokens.
  const riskList = Array.isArray(profile.riskSignals) ? profile.riskSignals : [];
  const risks = dedupe([
    ...riskList.map((r) => (typeof r === "string" ? r : str(obj(r).label) ?? str(obj(r).kind))),
    ...facts.filter((f) => f.startsWith("risk.")).map((f) => f.slice("risk.".length).replace(/_/g, " ")),
  ]);

  const eq = reasoning?.evidenceQuality;
  const quality: IntelligenceQuality | null = eq
    ? {
        usefulPages: typeof eq.usefulPages === "number" ? eq.usefulPages : null,
        uniqueSources: typeof eq.uniqueSources === "number" ? eq.uniqueSources : null,
        score: typeof eq.score === "number" ? eq.score : null,
        conflicts: Array.isArray(eq.conflicts) ? eq.conflicts.filter((c): c is string => typeof c === "string") : [],
      }
    : null;

  const confidenceReasons = Array.isArray(confidenceObj.reasons)
    ? (confidenceObj.reasons as unknown[]).filter((r): r is string => typeof r === "string")
    : [];

  const providerAttempts = (Array.isArray(coverage.providerAttempts) ? (coverage.providerAttempts as unknown[]) : [])
    .map((a) => {
      const rec = obj(a);
      const provider = str(rec.provider);
      if (!provider) return null;
      return {
        provider,
        status: str(rec.status) ?? "unknown",
        usableCount: typeof rec.usableCount === "number" ? (rec.usableCount as number) : null,
      };
    })
    .filter((v): v is { provider: string; status: string; usableCount: number | null } => v !== null);

  const categoryLabel = catId ? CATEGORY_LABEL[catId] ?? catId : null;
  // W5 (#6): derive the deeper "Category · Vertical" label from the deterministic served-vertical
  // classifier over the company's own text (summary + what they sell + AI vertical + facts). Pure,
  // no AI — safe to surface everywhere. e.g. "SaaS · FinTech", "Manufacturing · Wool".
  const industryText = [profile.companySummary, offering?.vertical, ...whatTheySell, ...facts]
    .filter(Boolean)
    .join(" ");
  const servedVerticals = classifyServedVerticals(
    industryText,
    2,
    catId ? CATEGORY_PREFERRED_SECTORS[catId] ?? [] : []
  );
  const industryDetail = formatIndustryDetail(categoryLabel, servedVerticals);

  return {
    available: Boolean(profile.companySummary || reasoning),
    companySummary: profile.companySummary,
    offeringType: offering?.type && offering.type !== "unknown" ? offering.type : null,
    vertical: offering?.vertical ?? null,
    category: categoryLabel,
    industryDetail,
    servedVerticals: servedVerticals.map((v) => ({ key: v.key, label: v.label, parentLabel: v.parentLabel })),
    confidence,
    whatTheySell,
    businessModel: reasoning && reasoning.businessModel.value.model !== "unknown"
      ? `${reasoning.businessModel.value.model}${reasoning.businessModel.value.pricingModel ? ` · ${reasoning.businessModel.value.pricingModel}` : ""}`
      : null,
    channels,
    likelyBuyers: catId ? BUYERS_BY_CATEGORY[catId] ?? [] : [],
    companySize: deriveCompanySize(facts),
    targetMarket: deriveTargetMarket(facts),
    growth: {
      hiringReal: bool(reasoning?.growth.hiring.value.real) || facts.includes("growth.hiring_real"),
      signals,
    },
    partnerships,
    maturity: {
      customers: facts.some((f) => f.startsWith("proof.")),
      partnerships: partnerships.length > 0 || facts.includes("proof.has_partnerships"),
      funding: facts.includes("growth.funding"),
      hiring: facts.includes("growth.hiring_real"),
    },
    evidence,
    claims,
    growthSignalsCited,
    partnershipsCited,
    footprint,
    risks,
    quality,
    confidenceReasons,
    providerAttempts,
    debug: {
      engine: str(engineTrace.engine),
      llmUsed: bool(engineTrace.llmUsed),
      providerUsed: firstProvider(coverage),
      pagesFetched: typeof coverage.pagesFetched === "number" ? (coverage.pagesFetched as number) : null,
      searchSufficient: typeof coverage.searchSufficient === "boolean" ? (coverage.searchSufficient as boolean) : null,
      fetchStatus: str(coverage.fetchStatus),
    },
    profileStatus: profile.profileStatus,
    staleAt: profile.staleAt,
  };
}

function emptyView(): IntelligenceView {
  return {
    available: false, companySummary: null, offeringType: null, vertical: null, category: null,
    industryDetail: null, servedVerticals: [],
    confidence: null, whatTheySell: [], businessModel: null, channels: [], likelyBuyers: [],
    companySize: null, targetMarket: [],
    growth: { hiringReal: false, signals: [] }, partnerships: [],
    maturity: { customers: false, partnerships: false, funding: false, hiring: false },
    evidence: [],
    claims: [], growthSignalsCited: [], partnershipsCited: [],
    footprint: { hqCountries: [], officeCountries: [], factoryCountries: [], marketCountries: [], revenueUsd: null, locationCount: null, multiLocation: false, recentNews: false },
    risks: [], quality: null, confidenceReasons: [], providerAttempts: [],
    debug: { engine: null, llmUsed: false, providerUsed: null, pagesFetched: null, searchSufficient: null, fetchStatus: null },
    profileStatus: null, staleAt: null,
  };
}

function labelOfferingType(type: string): string {
  return type.replace(/_/g, " ");
}

function normalizeConfidence(value: string | null): IntelligenceConfidence | null {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" ? value : null;
}

function labelOffering(token: string): string {
  return token.slice("offering.".length).replace(/_/g, " ");
}

function firstProvider(coverage: Record<string, unknown>): string | null {
  const attempts = Array.isArray(coverage.providerAttempts) ? (coverage.providerAttempts as unknown[]) : [];
  for (const a of attempts) {
    const rec = obj(a);
    if (rec.status === "ok" && rec.usableCount && (rec.usableCount as number) > 0) return str(rec.provider);
  }
  return attempts.length > 0 ? str(obj(attempts[0]).provider) : null;
}

function dedupe(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v?.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
