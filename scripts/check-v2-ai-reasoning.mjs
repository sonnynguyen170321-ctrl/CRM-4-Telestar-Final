// AI3 golden smoke: pure LLM prompt/parse grounding + hybrid merge with a MOCKED LLM.
// NO live API. Proves: (1) cited claims keep OUR evidence snippet, (2) a hallucinated
// citation is dropped, (3) garbage => safe empty, (4) hybrid merges the LLM over weak
// rules + recomputes controlled tokens.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { buildEvidenceIndex, buildLlmPrompt, parseLlmReasoning } = load("lib/v2/company-intelligence/reasoning/llmPrompt.ts");
const { HybridReasoningEngine } = load("lib/v2/company-intelligence/reasoning/hybridEngine.ts");

const input = {
  companyName: "Acme",
  canonicalDomain: "acme.com",
  country: "VN",
  pages: [
    { url: "https://acme.com/", pageType: "HOMEPAGE", title: "Acme", metaDescription: "SaaS platform for ecommerce sellers to automate fulfillment.", headings: ["Automate your store"], mainText: "Acme is a SaaS platform for online sellers." },
    { url: "https://acme.com/pricing", pageType: "PRICING", title: "Pricing", metaDescription: "Subscription plans from $49/mo.", headings: ["Plans"], mainText: "Monthly subscription pricing." },
  ],
  searchResults: [{ url: "https://news.example/acme-raises", text: "Acme raises $5M to expand into Thailand.", pageType: "SEARCH", provider: "exa" }],
};

const index = buildEvidenceIndex(input);
assert.equal(index.list.length, 3, "3 evidence entries (2 pages + 1 search)");
const prompt = buildLlmPrompt(input, index);
assert.ok(prompt.includes("https://acme.com/"), "prompt lists evidence urls");
assert.ok(prompt.includes("cite ONLY these urls"), "prompt enforces grounding");

// Mocked model output: grounded answers + ONE partnership citing a hallucinated url.
const mockText = "```json\n" + JSON.stringify({
  offering: { type: "saas", vertical: "ecommerce", primaryOffering: "ecommerce fulfillment automation", confidence: "HIGH", evidenceUrls: ["https://acme.com/"] },
  businessModel: { model: "B2B", pricingModel: "subscription", confidence: "HIGH", evidenceUrls: ["https://acme.com/pricing"] },
  channels: { value: ["direct", "garbage_channel"], confidence: "MEDIUM", evidenceUrls: ["https://acme.com/"] },
  hiring: { real: true, confidence: "MEDIUM", evidenceUrls: ["https://news.example/acme-raises"] },
  signals: [{ kind: "new_market", detail: "Expanding into Thailand", confidence: "MEDIUM", evidenceUrls: ["https://news.example/acme-raises"] }],
  partnerships: [{ name: "Shopify", kind: "integration", confidence: "LOW", evidenceUrls: ["https://hallucinated.example/x"] }],
}) + "\n```";

const r = parseLlmReasoning(mockText, index, 7);
assert.equal(r.offering.value.type, "saas");
assert.equal(r.offering.value.vertical, "ecommerce");
assert.equal(r.offering.confidence, "HIGH");
assert.equal(r.offering.evidence.length, 1);
// Evidence snippet is OURS (from the page), never the model's invented text.
assert.ok(r.offering.evidence[0].text.includes("SaaS platform for ecommerce"), "snippet comes from our evidence index");
assert.equal(r.businessModel.value.model, "B2B");
assert.equal(r.businessModel.value.pricingModel, "subscription");
assert.deepEqual(r.channels.value, ["direct"], "invalid channel token filtered out");
assert.equal(r.growth.hiring.value.real, true);
assert.equal(r.growth.signals.length, 1);
assert.equal(r.growth.signals[0].kind, "new_market");
// THE grounding guarantee: Shopify cited only a hallucinated url => dropped entirely.
assert.equal(r.partnerships.length, 0, "hallucinated-citation partnership must be dropped");
assert.equal(r.overallConfidence, "HIGH");

// Garbage => safe empty with a parse-error note (never throws).
const bad = parseLlmReasoning("the model said no", index, 7);
assert.equal(bad.offering.value.type, "unknown");
assert.ok(bad.engineTrace.notes.includes("llm_parse_error"));

// ---- hybrid merge over weak rules, with a MOCKED engine pair ----
const weakBase = {
  offering: { value: { type: "unknown", vertical: null, primaryOffering: "" }, confidence: "LOW", evidence: [] },
  businessModel: { value: { model: "unknown", pricingModel: null }, confidence: "LOW", evidence: [] },
  channels: { value: [], confidence: "LOW", evidence: [] },
  growth: { hiring: { value: { real: false }, confidence: "LOW", evidence: [] }, signals: [] },
  partnerships: [],
  overallConfidence: "LOW",
  evidenceQuality: { pagesFetched: 2, usefulPages: 1, uniqueSources: 1, score: 0, conflicts: [] },
  controlledTokens: ["category.ecommerce_ops"],
  engineTrace: { engine: "rules", llmUsed: false, pipelineVersion: 7, notes: ["taxonomy:ecommerce_ops"] },
};
const fakeRules = { id: "rules", reason: async () => JSON.parse(JSON.stringify(weakBase)) };
const fakeLlm = { id: "llm", reason: async () => r };
const hybrid = new HybridReasoningEngine(fakeRules, fakeLlm, { llmEnabled: true });
const merged = await hybrid.reason(input);
assert.equal(merged.engineTrace.llmUsed, true, "LLM should fire on weak/uncertain rules");
assert.equal(merged.offering.value.type, "saas", "LLM offering wins over unknown rules");
assert.equal(merged.businessModel.value.model, "B2B");
assert.ok(merged.controlledTokens.includes("offering.saas"), "tokens recomputed from merged offering");
assert.ok(merged.controlledTokens.includes("model.b2b"), "tokens recomputed from merged model");
assert.ok(merged.controlledTokens.includes("category.ecommerce_ops"), "rules taxonomy id carried through");

console.log("PASS V2 AI reasoning smoke (grounded parse + hallucination drop + hybrid merge + token recompute; no live API)");

function load(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s.startsWith("@/")) return resolveAndLoad(resolve(rootDir, s.slice(2)));
    if (s.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), s));
    return require(s);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return load(c.slice(rootDir.length + 1));
  return require(base);
}
