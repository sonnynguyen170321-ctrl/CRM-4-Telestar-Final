// AI3: pure prompt-building + strict grounded parsing for the LLM reasoning engine.
// No DB, no network, no provider client — so it unit-tests with a mocked LLM string.
//
// Grounding contract: the model may ONLY cite urls from the evidence we hand it. We
// resolve each cited url back to OUR trusted EvidenceRef (the snippet text is ours, not
// the model's) and drop any claim that cites an unknown url. A hallucinated citation
// therefore yields no evidence => the claim is dropped (no uncited claims downstream).

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
  type ReasoningInput,
  type SalesChannel,
} from "./contract";

const OFFERING_TYPES: OfferingType[] = ["saas", "vertical_saas", "product", "service", "marketplace", "ecommerce_platform", "agency", "unknown"];
const MODEL_KINDS: BusinessModelKind[] = ["B2B", "B2C", "B2B2C", "hybrid", "unknown"];
const CHANNELS: SalesChannel[] = ["direct", "partner", "marketplace", "reseller"];
const SIGNAL_KINDS: GrowthSignal["kind"][] = ["hiring", "funding", "new_market", "new_office", "product_launch"];
const PARTNER_KINDS: PartnershipClaim["kind"][] = ["partner", "integration", "customer"];
const CONFIDENCES: Confidence[] = ["HIGH", "MEDIUM", "LOW"];

export type EvidenceIndex = {
  /** Ordered list shown to the model (E1..En). */
  list: Array<{ id: string; ref: EvidenceRef }>;
  /** Resolve a cited url -> our trusted EvidenceRef (normalized, first wins). */
  byUrl: Map<string, EvidenceRef>;
};

export function buildEvidenceIndex(input: ReasoningInput): EvidenceIndex {
  const list: Array<{ id: string; ref: EvidenceRef }> = [];
  const byUrl = new Map<string, EvidenceRef>();
  const push = (ref: EvidenceRef) => {
    const key = normUrl(ref.url);
    if (!ref.url || !ref.text) return;
    if (!byUrl.has(key)) byUrl.set(key, ref);
    list.push({ id: `E${list.length + 1}`, ref });
  };
  for (const p of input.pages) {
    const text = firstNonEmpty([p.metaDescription, p.headings[0], p.title, snippet(p.mainText)]);
    if (text) push({ url: p.url, text, pageType: p.pageType, provider: "website" });
  }
  for (const r of input.searchResults) push(r);
  return { list, byUrl };
}

export const LLM_SYSTEM_PROMPT =
  "You are a precise B2B SDR research analyst. Answer five questions about a company " +
  "STRICTLY from the supplied evidence: (1) what they sell, (2) business model, " +
  "(3) sales channels / B2B-vs-B2C, (4) real hiring/expansion, (5) named partners. " +
  "Cite every claim with evidenceUrls drawn ONLY from the evidence list — never invent a " +
  "url, company, partner, or fact. If evidence is insufficient, answer \"unknown\"/[] " +
  "with LOW confidence. Output ONLY minified JSON in the requested shape, no prose.";

export function buildLlmPrompt(input: ReasoningInput, index: EvidenceIndex): string {
  const lines = index.list.map(({ id, ref }) => `[${id}] (${ref.pageType}) ${ref.url} — ${clip(ref.text, 280)}`);
  return [
    `COMPANY: ${input.companyName}${input.canonicalDomain ? ` (${input.canonicalDomain})` : ""}${input.country ? `, country: ${input.country}` : ""}`,
    "",
    "EVIDENCE (cite ONLY these urls):",
    ...(lines.length ? lines : ["(no evidence available)"]),
    "",
    "Respond with JSON of EXACTLY this shape (evidenceUrls subset of the urls above):",
    JSON.stringify({
      offering: { type: OFFERING_TYPES.join("|"), vertical: "string|null", primaryOffering: "string", confidence: "HIGH|MEDIUM|LOW", evidenceUrls: ["url"] },
      businessModel: { model: MODEL_KINDS.join("|"), pricingModel: "string|null", confidence: "HIGH|MEDIUM|LOW", evidenceUrls: ["url"] },
      channels: { value: [CHANNELS.join("|")], confidence: "HIGH|MEDIUM|LOW", evidenceUrls: ["url"] },
      hiring: { real: "boolean", confidence: "HIGH|MEDIUM|LOW", evidenceUrls: ["url"] },
      signals: [{ kind: SIGNAL_KINDS.join("|"), detail: "string", confidence: "HIGH|MEDIUM|LOW", evidenceUrls: ["url"] }],
      partnerships: [{ name: "string", kind: PARTNER_KINDS.join("|"), confidence: "HIGH|MEDIUM|LOW", evidenceUrls: ["url"] }],
    }),
  ].join("\n");
}

export function parseLlmReasoning(text: string, index: EvidenceIndex, pipelineVersion: number): CompanyIntelligenceReasoning {
  const json = extractJson(text);
  if (!json) return note(emptyReasoning(pipelineVersion, "llm"), "llm_parse_error");

  const resolve = (urls: unknown): EvidenceRef[] => {
    if (!Array.isArray(urls)) return [];
    const out: EvidenceRef[] = [];
    const seen = new Set<string>();
    for (const u of urls) {
      if (typeof u !== "string") continue;
      const ref = index.byUrl.get(normUrl(u));
      if (ref && !seen.has(ref.url)) {
        seen.add(ref.url);
        out.push(ref);
      }
    }
    return out;
  };
  const conf = (v: unknown): Confidence => (CONFIDENCES.includes(v as Confidence) ? (v as Confidence) : "LOW");

  const off = obj(json.offering);
  const offering: ReasonedField<{ type: OfferingType; vertical: string | null; primaryOffering: string }> = {
    value: {
      type: OFFERING_TYPES.includes(off.type as OfferingType) ? (off.type as OfferingType) : "unknown",
      vertical: str(off.vertical),
      primaryOffering: str(off.primaryOffering) ?? "",
    },
    confidence: conf(off.confidence),
    evidence: resolve(off.evidenceUrls),
  };

  const bm = obj(json.businessModel);
  const businessModel: ReasonedField<{ model: BusinessModelKind; pricingModel: string | null }> = {
    value: {
      model: MODEL_KINDS.includes(bm.model as BusinessModelKind) ? (bm.model as BusinessModelKind) : "unknown",
      pricingModel: str(bm.pricingModel),
    },
    confidence: conf(bm.confidence),
    evidence: resolve(bm.evidenceUrls),
  };

  const ch = obj(json.channels);
  const channels: ReasonedField<SalesChannel[]> = {
    value: Array.isArray(ch.value) ? (ch.value.filter((c) => CHANNELS.includes(c as SalesChannel)) as SalesChannel[]) : [],
    confidence: conf(ch.confidence),
    evidence: resolve(ch.evidenceUrls),
  };

  const hi = obj(json.hiring);
  const hiring: ReasonedField<{ real: boolean }> = {
    value: { real: hi.real === true },
    confidence: conf(hi.confidence),
    evidence: resolve(hi.evidenceUrls),
  };

  const signals: GrowthSignal[] = arr(json.signals)
    .map((raw) => {
      const s = obj(raw);
      return {
        kind: (SIGNAL_KINDS.includes(s.kind as GrowthSignal["kind"]) ? s.kind : "product_launch") as GrowthSignal["kind"],
        detail: clip(str(s.detail) ?? "", 200),
        confidence: conf(s.confidence),
        evidence: resolve(s.evidenceUrls),
      };
    })
    .filter((s) => s.detail.length > 0);

  const partnerships: PartnershipClaim[] = arr(json.partnerships)
    .map((raw) => {
      const p = obj(raw);
      return {
        name: clip(str(p.name) ?? "", 80),
        kind: (PARTNER_KINDS.includes(p.kind as PartnershipClaim["kind"]) ? p.kind : "partner") as PartnershipClaim["kind"],
        confidence: conf(p.confidence),
        evidence: resolve(p.evidenceUrls),
      };
    })
    .filter((p) => p.name.length > 0);

  const grounded = offering.evidence.length + businessModel.evidence.length + channels.evidence.length;
  const overallConfidence: Confidence =
    offering.evidence.length > 0 && businessModel.evidence.length > 0 && (offering.confidence === "HIGH" || businessModel.confidence === "HIGH")
      ? "HIGH"
      : grounded > 0
        ? "MEDIUM"
        : "LOW";

  const reasoning: CompanyIntelligenceReasoning = {
    offering,
    businessModel,
    channels,
    growth: { hiring, signals },
    partnerships,
    overallConfidence,
    evidenceQuality: {
      pagesFetched: index.list.length,
      usefulPages: new Set([...offering.evidence, ...businessModel.evidence, ...channels.evidence].map((e) => e.url)).size,
      uniqueSources: new Set(index.list.map((e) => safeDomain(e.ref.url)).filter(Boolean)).size,
      score: grounded,
      conflicts: [],
    },
    controlledTokens: [], // hybrid/caller recomputes via deriveControlledTokens
    engineTrace: { engine: "llm", llmUsed: true, pipelineVersion, notes: ["llm_grounded"] },
  };

  // Final guard: drop any claim that ended up uncited (e.g. only hallucinated urls).
  return dropUncitedClaims(reasoning);
}

// ---- small pure helpers ----
function note(r: CompanyIntelligenceReasoning, n: string): CompanyIntelligenceReasoning {
  return { ...r, engineTrace: { ...r.engineTrace, notes: [...r.engineTrace.notes, n] } };
}
function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.replace(/```json\s*|\s*```/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const v of values) if (v && v.trim()) return v.trim();
  return null;
}
function snippet(text: string | null): string | null {
  if (!text) return null;
  return text.replace(/\s+/g, " ").trim().slice(0, 280) || null;
}
function clip(text: string, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s\S*$/, "")}…` : t;
}
function normUrl(url: string): string {
  return (url ?? "").trim().toLowerCase().replace(/\/+$/, "");
}
function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
