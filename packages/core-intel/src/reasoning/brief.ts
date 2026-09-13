import type { CompanyIntelligenceReasoning, OfferingType } from "./contract";

// CINT3: deterministic one-line company brief (-> companySummary). Identity-first,
// never "pricing page present" / "3 facts". Priority: strong cited offering -> typed
// category -> low-confidence fallback. Compact + human-readable for SDR review.

const TYPE_LABEL: Record<OfferingType, string> = {
  saas: "B2B software",
  vertical_saas: "vertical SaaS",
  product: "product",
  service: "services",
  marketplace: "marketplace",
  ecommerce_platform: "ecommerce platform",
  agency: "agency / services",
  unknown: "company",
};

export function compileBrief(reasoning: CompanyIntelligenceReasoning, companyName: string): string {
  const company = companyName.trim() || "This company";
  const o = reasoning.offering;
  const offering = o.value.primaryOffering?.trim();
  const verticalSuffix = o.value.vertical ? ` for ${o.value.vertical} brands` : "";

  if (o.value.type === "unknown" && !offering) {
    return `${company} has insufficient public website evidence for a confident company summary.`;
  }

  if (offering && (o.confidence === "HIGH" || o.confidence === "MEDIUM")) {
    // Trim trailing punctuation from the offering phrase before composing.
    const phrase = offering.replace(/[.\s]+$/, "");
    return `${company} provides ${lowerFirst(phrase)}${verticalSuffix}.`;
  }

  const typeLabel = TYPE_LABEL[o.value.type];
  return `${company} appears to be a ${typeLabel}${verticalSuffix} company, based on public website evidence.`;
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
