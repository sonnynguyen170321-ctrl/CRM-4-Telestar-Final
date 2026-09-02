import "server-only";

import {
  dropUncitedClaims,
  emptyReasoning,
  type BusinessModelKind,
  type CompanyIntelligenceReasoning,
  type Confidence,
  type EvidenceRef,
  type GrowthSignal,
  type OfferingType,
  type PartnershipClaim,
  type ReasonedField,
  type ReasoningEngine,
  type ReasoningInput,
  type SalesChannel,
} from "./contract";
import { AUDIENCE_PAGE_TYPES, IDENTITY_PAGE_TYPES } from "./pageModel";
import { linkedInIndustryHint, matchTaxonomy } from "./taxonomy";
import { COMPANY_INTEL_PIPELINE_VERSION } from "../pipelineVersion";

// CINT3: deterministic rule reasoning engine. Consumes the evidence bundle and emits
// the stable CINT1 contract — answering the 5 SDR questions with cited claims. No
// LLM. Low-confidence/gap fields are left for the hybrid LLM fallback to refine.

const PARTNER_HINT = /\b(partner|partners|integrat|reseller|ecosystem)\b/i;
// Genuine hiring INTENT only. Dropped bare "careers" / "join our team" — footer/nav boilerplate
// that fired "hiring/expansion" on almost every site (incl. empty careers pages).
const HIRING_HINT = /\b(we(?:'| a)?re hiring|now hiring|hiring for\b|open (?:roles?|positions?)|job openings?|[1-9]\d*\s+open (?:roles?|positions?))\b/i;
const JOB_TITLE_HINT = /\b(engineer|manager|sales|marketing|designer|developer|account executive|recruiter)\b/i;
const FUNDING_HINT = /\b(raised \$?[\d.]|series [a-d]\b|seed round|venture capital|secured \$?[\d.]|funding round)\b/i;
// Tightened: a real market-expansion signal needs an explicit "expand into / new
// market / new office in / entering <x> market / acquired" — not a bare "launches".
const EXPANSION_HINT = /\b(expand(?:ing|ed|s)?\s+(?:into|to|in)\b|new market\b|entering (?:the )?[a-z]+ market|new office in\b|opened? (?:a |an |its )?(?:new )?office\b|acquir(?:ed|es|ing)\b)/i;
const B2C_HINT = /\b(consumers?|shoppers?|individuals?|personal use|for you\b|families)\b/i;
const B2B_HINT = /\b(businesses?|enterprises?|teams?|companies|organizations?|b2b|saas)\b/i;
const MARKETPLACE_HINT = /\b(marketplace|app store|listed on)\b/i;

function lc(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/** Result of assembling the text the category taxonomy is allowed to read. */
type ClassificationCorpus = {
  text: string;
  /** True when no identity page survived and the whole crawl had to be used instead. */
  usedFallback: boolean;
  identityPageCount: number;
};

/**
 * Build the text `matchTaxonomy` classifies on.
 *
 * Two things separate this from the citation corpus above, and both were defects:
 *
 * 1. **It reads the whole page, not a 400-character blurb.** The evidence refs are built for
 *    citation — `metaDescription + first heading + first 200 chars of body`, capped at 400. Feeding
 *    those to the classifier meant judging Jabil on 4,619 of the 53,311 characters actually crawled
 *    (8.7%), and the answer was NO CATEGORY; on the full text the same rules return `manufacturing`
 *    with four keyword hits. Tightening the matcher to word-boundary matching with a two-hit minimum
 *    made this starvation much worse, because a stricter matcher over a tiny sample simply finds
 *    nothing.
 *
 * 2. **It only reads pages that describe the company.** See IDENTITY_PAGE_TYPES / AUDIENCE_PAGE_TYPES.
 *
 * Search snippets are always included: they describe the company from the outside, and for the ~37%
 * of real domains that answer OFFLINE or BLOCKED to a crawler they are the only evidence there is.
 *
 * Title, meta description and H1 are repeated three times. In a bag-of-words scorer, repetition IS
 * the weight — those three fields are the company's own one-line answer to "what are you", while body
 * text is padded with navigation, footers and boilerplate.
 */
export function buildClassificationCorpus(input: ReasoningInput): ClassificationCorpus {
  const isIdentity = (page: ReasoningInput["pages"][number]) =>
    (IDENTITY_PAGE_TYPES as ReadonlySet<string>).has(page.pageType);
  const isAudience = (page: ReasoningInput["pages"][number]) =>
    (AUDIENCE_PAGE_TYPES as ReadonlySet<string>).has(page.pageType);

  // Exclude what is known to describe someone else; keep everything else. Whitelisting only the
  // identity types looked tidier but threw away every UNKNOWN page — and `classifyPageType` files a
  // large share of real pages as UNKNOWN, which is most of the text on many sites.
  const usable = input.pages.filter((page) => !isAudience(page));
  const identityPages = input.pages.filter(isIdentity);

  // Nothing but audience pages still has to be classified from something. Using them is better than
  // returning nothing, but the caller lowers confidence to say so.
  const usedFallback = usable.length === 0;
  const pages = usedFallback ? input.pages : usable;

  const pageText = pages.map((page) => {
    const headline = [page.title, page.metaDescription, page.headings?.[0]].filter(Boolean).join(" · ");
    // Repetition is the weight. An identity page's own one-line answer to "what are you" counts for
    // three; a page we merely could not classify contributes its headline once.
    const repeats = isIdentity(page) ? 3 : 1;
    return [
      ...Array.from({ length: repeats }, () => headline),
      (page.headings ?? []).join(" · "),
      page.mainText,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  const searchText = input.searchResults.map((ref) => ref.text);

  return {
    text: [...pageText, ...searchText].join(" \n ").toLowerCase(),
    usedFallback,
    identityPageCount: identityPages.length,
  };
}

export class RuleReasoningEngine implements ReasoningEngine {
  readonly id = "rules" as const;

  async reason(input: ReasoningInput): Promise<CompanyIntelligenceReasoning> {
    const pageRefs: EvidenceRef[] = input.pages.map((p) => ({
      url: p.url,
      text: [p.metaDescription, p.headings?.[0], p.mainText?.slice(0, 200)].filter(Boolean).join(" · ").slice(0, 400),
      pageType: p.pageType,
      provider: "website",
    }));
    const searchRefs = input.searchResults;
    const allRefs = [...pageRefs, ...searchRefs];
    const corpus = allRefs.map((r) => `${r.text}`).join(" \n ").toLowerCase();
    const company = input.companyName.trim() || "This company";

    if (allRefs.length === 0 || corpus.trim().length < 20) {
      return emptyReasoning(COMPANY_INTEL_PIPELINE_VERSION, "rules");
    }

    const classification = buildClassificationCorpus(input);

    // The imported industry is a weak prior: append its canonical keyword (if any) so it can only
    // contribute a single keyword hit — never enough to assign a category on its own (see taxonomy).
    const hint = linkedInIndustryHint(input.industryRaw);
    const tax = matchTaxonomy(hint ? `${classification.text} ${hint}` : classification.text);

    // --- Q1 offering ---
    let offeringType: OfferingType = tax?.category.offeringType ?? "unknown";
    let vertical: string | null = tax?.category.vertical ?? null;
    // vertical-SaaS refinement: software/SaaS + an ecommerce vertical keyword.
    if ((offeringType === "saas" || corpus.includes("saas") || corpus.includes("platform")) &&
        /\b(shopify|ecommerce|e-commerce|dtc|merchants)\b/.test(corpus)) {
      offeringType = "vertical_saas";
      vertical = "ecommerce";
    }
    const primaryOffering =
      firstNonEmpty(input.pages.map((p) => (p.pageType === "HOMEPAGE" || p.pageType === "ABOUT" ? p.metaDescription : null))) ??
      firstNonEmpty(input.pages.map((p) => p.headings?.[0] ?? null)) ??
      (tax ? tax.matchedKeywords.slice(0, 3).join(", ") : "");
    const offeringEvidence = pickEvidence(allRefs, (r) =>
      ["HOMEPAGE", "ABOUT", "PRODUCT", "PLATFORM", "SOLUTION", "SERVICE"].includes(r.pageType) || r.provider !== "website"
    );
    // A verdict reached without a single identity page is a guess off whatever the crawler happened
    // to reach, so it never claims HIGH — the downstream qualification reads this.
    const offeringConfidence: Confidence =
      tax && tax.score >= 4 && offeringEvidence.length > 0 && !classification.usedFallback ? "HIGH"
      : tax && offeringEvidence.length > 0 ? "MEDIUM" : "LOW";
    const offering: ReasonedField<{ type: OfferingType; vertical: string | null; primaryOffering: string }> = {
      value: { type: offeringType, vertical, primaryOffering: primaryOffering.slice(0, 200) },
      confidence: offeringType === "unknown" ? "LOW" : offeringConfidence,
      evidence: offeringEvidence.slice(0, 3),
    };

    // --- Q2 business model ---
    const model = inferBusinessModel(corpus, tax?.category.businessModel ?? "unknown");
    const businessModel: ReasonedField<{ model: BusinessModelKind; pricingModel: string | null }> = {
      value: { model, pricingModel: corpus.includes("subscription") ? "subscription" : null },
      confidence: model === "unknown" ? "LOW" : "MEDIUM",
      evidence: pickEvidence(allRefs, (r) => B2B_HINT.test(r.text) || B2C_HINT.test(r.text)).slice(0, 2),
    };

    // --- Q3 channels ---
    const channels: SalesChannel[] = ["direct"];
    if (PARTNER_HINT.test(corpus)) channels.push("partner");
    if (MARKETPLACE_HINT.test(corpus)) channels.push("marketplace");
    const channelsField: ReasonedField<SalesChannel[]> = {
      value: Array.from(new Set(channels)),
      confidence: channels.length > 1 ? "MEDIUM" : "LOW",
      evidence: pickEvidence(allRefs, (r) => PARTNER_HINT.test(r.text) || MARKETPLACE_HINT.test(r.text)).slice(0, 2),
    };

    // --- Q4 growth: real hiring + expansion/funding ---
    // Real hiring needs the intent phrase PLUS corroboration: an actual role title, or a
    // non-website source (e.g. a jobs board / news). A bare CAREERS/JOBS page type is no longer a
    // free pass — an empty or soft-404 careers page must not imply hiring.
    const hiringEvidence = pickEvidence(allRefs, (r) => HIRING_HINT.test(r.text) && (JOB_TITLE_HINT.test(r.text) || r.provider !== "website"));
    const signals: GrowthSignal[] = [];
    const seenSignal = new Set<string>();
    for (const r of allRefs) {
      const kind = FUNDING_HINT.test(r.text) ? "funding" : EXPANSION_HINT.test(r.text) ? "new_market" : null;
      if (!kind) continue;
      const detail = cleanSignalDetail(r.text, company);
      if (!detail) continue;
      const dedupeKey = `${kind}:${detail.slice(0, 40).toLowerCase()}`;
      if (seenSignal.has(dedupeKey)) continue;
      seenSignal.add(dedupeKey);
      signals.push({ kind, detail, confidence: kind === "funding" ? "MEDIUM" : "LOW", evidence: [r] });
      if (signals.length >= 3) break;
    }

    // --- Q5 partnerships ---
    const partnerships = extractPartnerships(allRefs);

    // --- evidence quality + confidence ---
    const usefulPages = input.pages.filter((p) => (p.mainText?.length ?? 0) > 80 || p.metaDescription).length;
    const uniqueSources = new Set(allRefs.map((r) => safeDomain(r.url)).filter(Boolean)).size;
    const score = (tax?.score ?? 0) + offeringEvidence.length * 2 + (hiringEvidence.length ? 1 : 0) + signals.length;
    const overallConfidence: Confidence =
      offering.confidence === "HIGH" && usefulPages >= 2 ? "HIGH"
      : offering.value.type !== "unknown" && usefulPages >= 1 ? "MEDIUM" : "LOW";

    const reasoning: CompanyIntelligenceReasoning = {
      offering,
      businessModel,
      channels: channelsField,
      growth: {
        hiring: { value: { real: hiringEvidence.length > 0 }, confidence: hiringEvidence.length > 0 ? "MEDIUM" : "LOW", evidence: hiringEvidence.slice(0, 2) },
        signals,
      },
      partnerships,
      overallConfidence,
      evidenceQuality: { pagesFetched: input.pages.length, usefulPages, uniqueSources, score, conflicts: [] },
      controlledTokens: [],
      engineTrace: { engine: "rules", llmUsed: false, pipelineVersion: COMPANY_INTEL_PIPELINE_VERSION, notes: tax ? [`taxonomy:${tax.category.id}`] : ["no_taxonomy_match"] },
    };
    const citedReasoning = dropUncitedClaims(reasoning);
    citedReasoning.controlledTokens = deriveControlledTokens(
      citedReasoning,
      citedReasoning.offering.evidence.length > 0 ? tax?.category.id ?? null : null,
      company
    );
    return citedReasoning;
  }
}

function inferBusinessModel(corpus: string, hint: BusinessModelKind): BusinessModelKind {
  const b2b = B2B_HINT.test(corpus);
  const b2c = B2C_HINT.test(corpus);
  if (b2b && b2c) return "B2B2C";
  if (b2b) return "B2B";
  if (b2c) return "B2C";
  return hint;
}

function extractPartnerships(refs: EvidenceRef[]): PartnershipClaim[] {
  const out: PartnershipClaim[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (!PARTNER_HINT.test(r.text)) continue;
    // Proper-noun-ish tokens near a partner/integration mention (best-effort; LLM
    // fallback refines). Capitalized words, excluding the leading sentence word.
    const names = (r.text.match(/\b([A-Z][a-zA-Z0-9.&-]{2,})\b/g) ?? []).filter((n) => !STOP_NAMES.has(n.toLowerCase()));
    for (const name of names.slice(0, 4)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, kind: /integrat/i.test(r.text) ? "integration" : "partner", confidence: "LOW", evidence: [r] });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

const STOP_NAMES = new Set(["the", "our", "we", "partners", "partner", "integrations", "integration", "with", "and", "platform", "company", "inc", "ltd"]);

// Turn a raw search/page snippet into a clean one-line signal detail: collapse
// whitespace, drop the repeated title==highlight duplication that providers return,
// strip a leading company-name echo, and trim to one readable clause.
function cleanSignalDetail(text: string, company: string): string {
  let t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Split on the joiner we use plus sentence-ish breaks, dedupe segments.
  const segs = t.split(/\s+[·—–-]\s+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const s of segs) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    if (kept.some((k) => k.toLowerCase().includes(key) || key.includes(k.toLowerCase()))) continue;
    seen.add(key);
    kept.push(s);
  }
  t = kept.join(" — ");
  // Drop an immediately repeated phrase ("Foo bar Foo bar..." -> "Foo bar").
  t = dropRepeatedPhrase(t);
  // Strip a leading "Company: " / "Company - " echo.
  const co = company.trim();
  if (co && t.toLowerCase().startsWith(co.toLowerCase())) {
    t = t.slice(co.length).replace(/^\s*[:\-–—]\s*/, "").trim() || t;
  }
  return t.length > 140 ? `${t.slice(0, 139).replace(/\s\S*$/, "")}…` : t;
}

function dropRepeatedPhrase(text: string): string {
  const words = text.split(" ");
  // Find the largest k (up to half) where the first k words repeat immediately after.
  for (let k = Math.floor(words.length / 2); k >= 3; k--) {
    const first = words.slice(0, k).join(" ").toLowerCase();
    const next = words.slice(k, 2 * k).join(" ").toLowerCase();
    if (first === next) return words.slice(0, k).join(" ") + " " + words.slice(2 * k).join(" ");
  }
  return text;
}

function pickEvidence(refs: EvidenceRef[], predicate: (r: EvidenceRef) => boolean): EvidenceRef[] {
  return refs.filter((r) => r.text && predicate(r));
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const v of values) if (v && v.trim()) return v.trim();
  return null;
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Controlled token vocabulary (stable; scoring reads these — CINT4).
export function deriveControlledTokens(
  r: CompanyIntelligenceReasoning,
  taxonomyId: string | null,
  _company: string
): string[] {
  const tokens = new Set<string>();
  if (r.offering.evidence.length > 0 && r.offering.value.type !== "unknown") {
    tokens.add(`offering.${r.offering.value.type}`);
  }
  if (r.offering.evidence.length > 0 && r.offering.value.vertical) {
    tokens.add(`vertical.${r.offering.value.vertical}`);
  }
  if (taxonomyId) tokens.add(`category.${taxonomyId}`);
  if (r.businessModel.evidence.length > 0 && r.businessModel.value.model !== "unknown") {
    tokens.add(`model.${r.businessModel.value.model.toLowerCase()}`);
  }
  if (r.businessModel.evidence.length > 0 && r.businessModel.value.pricingModel) {
    tokens.add(`pricing.${r.businessModel.value.pricingModel}`);
  }
  if (r.channels.evidence.length > 0) {
    for (const c of r.channels.value) tokens.add(`channel.${c}`);
  }
  if (r.growth.hiring.evidence.length > 0 && r.growth.hiring.value.real) {
    tokens.add("growth.hiring_real");
  }
  for (const s of r.growth.signals) tokens.add(`growth.${s.kind}`);
  if (r.partnerships.length > 0) tokens.add("proof.has_partnerships");
  return Array.from(tokens).sort();
}
