import type { CompanyEvidence } from "../scoring/icpRulesSchema";

/**
 * Maps neutral fact tokens (V2CompanyIntelligenceProfile.factsJson) onto the
 * CompanyEvidence fields consumed by assessCompanyAgainstIcp's evidenceText
 * matching. This is account-level pre-rank evidence only: it never sets
 * qualification, fitScore, confidenceScore, or persona fields. Persona
 * evidence continues to come from contact title / lead assignment data.
 */

const GEO_SLUG_DISPLAY_NAMES: Record<string, string> = {
  united_states: "United States",
  united_kingdom: "United Kingdom",
  south_korea: "South Korea",
  hong_kong: "Hong Kong",
};

export type IntelligenceCompanyEvidence = Pick<
  CompanyEvidence,
  | "description"
  | "industryTags"
  | "industryCategory"
  | "productSignals"
  | "serviceSignals"
  | "pricingSignals"
  | "platformSignals"
  | "notes"
  | "pipelineInferredCountry"
  | "websiteStatus"
  | "employeeCount"
  | "employeeRange"
  | "revenueUsd"
  | "officeCountries"
  | "locationCount"
  | "evidenceText"
>;

export type IntelligenceEvidenceContext = {
  sourceCoverageJson?: unknown;
  profileStatus?: string | null;
};

export function mapNeutralFactsToCompanyEvidence(
  facts: string[],
  context: IntelligenceEvidenceContext = {}
): IntelligenceCompanyEvidence {
  const description: string[] = [];
  const industryTags = new Set<string>();
  const productSignals = new Set<string>();
  const serviceSignals = new Set<string>();
  const pricingSignals = new Set<string>();
  const platformSignals = new Set<string>();
  const notes: string[] = [];
  const officeCountries = new Set<string>();
  let pipelineInferredCountry: string | undefined;
  let employeeCount: number | undefined;
  let employeeRange: string | undefined;
  let revenueUsd: number | undefined;
  let locationCount: number | undefined;

  for (const token of facts) {
    switch (token) {
      case "offering.saas":
        productSignals.add("SaaS");
        break;
      case "offering.cybersecurity":
        productSignals.add("cybersecurity");
        serviceSignals.add("security");
        industryTags.add("CYBERSECURITY");
        description.push("cybersecurity offering");
        break;
      case "offering.erp":
        productSignals.add("ERP");
        industryTags.add("ERP_MANUFACTURING");
        description.push("ERP offering");
        break;
      case "offering.cloud_infrastructure":
        platformSignals.add("cloud infrastructure");
        industryTags.add("CLOUD_INFRA");
        description.push("cloud infrastructure offering");
        break;
      case "offering.consulting":
        serviceSignals.add("consulting");
        break;
      case "business_model.b2b":
        notes.push("B2B business model");
        break;
      case "business_model.b2c":
        notes.push("B2C business model");
        break;
      case "business_model.marketplace":
        notes.push("marketplace business model");
        break;
      case "industry.banking":
        industryTags.add("BANKING");
        description.push("banking industry");
        break;
      case "industry.manufacturing":
        industryTags.add("MANUFACTURING");
        description.push("manufacturing industry");
        break;
      case "industry.retail":
        industryTags.add("RETAIL");
        description.push("retail industry");
        break;
      case "industry.telecom":
        industryTags.add("TELECOM");
        description.push("telecom industry");
        break;
      case "maturity.has_pricing_page":
        pricingSignals.add("pricing page");
        break;
      case "maturity.hiring":
        notes.push("actively hiring");
        break;
      case "maturity.has_case_studies":
        notes.push("has case studies");
        break;
      case "growth.funding":
        notes.push("recent funding");
        break;
      case "growth.expansion":
        notes.push("recent expansion");
        break;
      case "news.recent":
        notes.push("recent news coverage");
        break;
      case "proof.case_study":
        notes.push("case study evidence");
        break;
      case "proof.customer_logo":
        notes.push("customer logo evidence");
        break;
      case "risk.service_product_ambiguity":
        notes.push("service/product ambiguity risk");
        break;
      default: {
        if (token.startsWith("geo.hq_country_")) {
          const slug = token.slice("geo.hq_country_".length);
          const displayName = geoSlugToDisplayName(slug);
          pipelineInferredCountry = pipelineInferredCountry ?? displayName;
          description.push(`headquartered in ${displayName}`);
        } else if (token.startsWith("geo.office_country_")) {
          const slug = token.slice("geo.office_country_".length);
          const displayName = geoSlugToDisplayName(slug);
          officeCountries.add(displayName);
          description.push(`office in ${displayName}`);
        } else if (token.startsWith("geo.factory_country_")) {
          const slug = token.slice("geo.factory_country_".length);
          const displayName = geoSlugToDisplayName(slug);
          officeCountries.add(displayName);
          description.push(`factory in ${displayName}`);
        } else if (token.startsWith("geo.market_")) {
          const slug = token.slice("geo.market_".length);
          description.push(`market presence in ${geoSlugToDisplayName(slug)}`);
        } else if (token.startsWith("size.employee_count_")) {
          const parsed = parsePositiveInteger(token.slice("size.employee_count_".length));
          if (parsed !== undefined) {
            employeeCount = employeeCount ?? parsed;
            description.push(`${parsed.toLocaleString("en-US")} employees`);
          }
        } else if (token.startsWith("size.range_")) {
          const band = token.slice("size.range_".length);
          if (isSafeDynamicValue(band)) {
            employeeRange = employeeRange ?? band.replace(/_/g, " ");
            description.push(`size band ${employeeRange}`);
          }
        } else if (token.startsWith("revenue.usd_")) {
          const parsed = parsePositiveInteger(token.slice("revenue.usd_".length));
          if (parsed !== undefined) {
            revenueUsd = revenueUsd ?? parsed;
            description.push(`revenue $${parsed.toLocaleString("en-US")}`);
          }
        } else if (token.startsWith("location.count_")) {
          const parsed = parsePositiveInteger(token.slice("location.count_".length));
          if (parsed !== undefined) {
            locationCount = locationCount ?? parsed;
            description.push(`${parsed.toLocaleString("en-US")} locations`);
          }
        } else if (token === "location.multi_location") {
          locationCount = locationCount ?? 2;
          notes.push("multi-location business");
        }
        break;
      }
    }
  }

  // The Axis-1 category token, carried through to scoring so `industryScore` can resolve the served
  // vertical inside the right sector instead of re-deriving it from raw text.
  const categoryFact = facts.find((fact) => fact.startsWith("category."));

  return {
    description: description.length > 0 ? description.join("; ") : undefined,
    industryTags: industryTags.size > 0 ? Array.from(industryTags) : undefined,
    industryCategory: categoryFact ? categoryFact.slice("category.".length) : undefined,
    productSignals: productSignals.size > 0 ? Array.from(productSignals) : undefined,
    serviceSignals: serviceSignals.size > 0 ? Array.from(serviceSignals) : undefined,
    pricingSignals: pricingSignals.size > 0 ? Array.from(pricingSignals) : undefined,
    platformSignals: platformSignals.size > 0 ? Array.from(platformSignals) : undefined,
    notes: notes.length > 0 ? notes.join("; ") : undefined,
    pipelineInferredCountry,
    employeeCount,
    employeeRange,
    revenueUsd,
    officeCountries: officeCountries.size > 0 ? Array.from(officeCountries).sort() : undefined,
    locationCount,
    evidenceText: [...description, ...notes].join("; ") || undefined,
    websiteStatus: mapWebsiteStatus(context),
  };
}

function mapWebsiteStatus(
  context: IntelligenceEvidenceContext
): IntelligenceCompanyEvidence["websiteStatus"] {
  const coverage =
    context.sourceCoverageJson &&
    typeof context.sourceCoverageJson === "object" &&
    !Array.isArray(context.sourceCoverageJson)
      ? (context.sourceCoverageJson as Record<string, unknown>)
      : {};
  const fetchStatus =
    typeof coverage.fetchStatus === "string" ? coverage.fetchStatus : "";

  if (fetchStatus === "SUCCESS" || fetchStatus === "PARTIAL") {
    return "reachable";
  }

  if (
    fetchStatus === "OFFLINE" ||
    fetchStatus === "BLOCKED" ||
    fetchStatus === "TIMEOUT" ||
    fetchStatus === "PARKED" ||
    fetchStatus === "INVALID_URL"
  ) {
    return "offline";
  }

  if (fetchStatus === "NO_WEBSITE") {
    return "missing";
  }

  // No conclusive fetch signal => preserve the long-standing default ("reachable")
  // so scoring behavior + the contract test are unchanged (statuses like
  // JS_RENDER_REQUIRED / NOT_RUN fall through here).
  return "reachable";
}

function geoSlugToDisplayName(slug: string): string {
  return (
    GEO_SLUG_DISPLAY_NAMES[slug] ??
    slug
      .split("_")
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join(" ")
  );
}

function parsePositiveInteger(raw: string): number | undefined {
  if (!/^[1-9]\d{0,12}$/.test(raw)) {
    return undefined;
  }

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isSafeDynamicValue(value: string): boolean {
  return /^[A-Z_]{2,40}$/.test(value);
}
