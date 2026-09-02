// CINT5 mock-only smoke: the shared intelligence presenter maps a persisted profile
// (JSON cols) into the identity-first view. Pure.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { presentCompanyIntelligence } = load("lib/v2/company-intelligence/presentIntelligence.ts");

// empty profile => not available
{
  const v = presentCompanyIntelligence(null);
  assert.equal(v.available, false);
}

// Postscript-like persisted profile
const reasoning = {
  offering: { value: { type: "vertical_saas", vertical: "ecommerce", primaryOffering: "SMS marketing for Shopify brands" }, confidence: "HIGH", evidence: [{ url: "https://postscript.io/", text: "SMS for Shopify", pageType: "HOMEPAGE", provider: "website" }] },
  businessModel: { value: { model: "B2B", pricingModel: "subscription" }, confidence: "MEDIUM", evidence: [] },
  channels: { value: ["direct", "marketplace"], confidence: "MEDIUM", evidence: [] },
  growth: { hiring: { value: { real: true }, confidence: "MEDIUM", evidence: [] }, signals: [{ kind: "funding", detail: "$35M Series B", confidence: "MEDIUM", evidence: [] }] },
  partnerships: [{ name: "Shopify", kind: "partner", confidence: "LOW", evidence: [] }, { name: "Klaviyo", kind: "integration", confidence: "LOW", evidence: [] }],
  overallConfidence: "HIGH",
  evidenceQuality: { pagesFetched: 6, usefulPages: 5, uniqueSources: 4, score: 11, conflicts: [] },
  controlledTokens: [],
  engineTrace: { engine: "hybrid", llmUsed: false, pipelineVersion: 2, notes: [] },
};

const profile = {
  id: "p1",
  companySummary: "Postscript provides SMS marketing for ecommerce brands.",
  facts: ["offering.vertical_saas", "vertical.ecommerce", "category.ecommerce_saas", "model.b2b", "growth.funding", "growth.hiring_real", "proof.has_partnerships"],
  factsByFamily: [],
  evidenceItems: [
    { token: "offering.vertical_saas", family: "HOMEPAGE", evidenceText: "SMS marketing platform built for Shopify ecommerce brands", sourceUrl: "https://postscript.io/" },
    { token: "growth.funding", family: "SEARCH", evidenceText: "raised $35M Series B", sourceUrl: "https://techcrunch.com/postscript" },
  ],
  evidenceByFamily: [],
  classification: { schemaVersion: "v2.company-intelligence.reasoning.v1", reasoning },
  sourceCoverage: { pagesFetched: 6, searchSufficient: true, fetchStatus: "SUCCESS", providerAttempts: [{ provider: "exa", status: "ok", usableCount: 5 }] },
  riskSignals: [],
  confidence: { overallConfidence: "HIGH", band: "HIGH", evidenceConfidence: 0.9, engineTrace: { engine: "hybrid", llmUsed: false } },
  profileStatus: "EXTRACTED",
  staleAt: null,
  researchVersion: 2,
  createdAt: "2026-06-21T00:00:00.000Z",
};

const v = presentCompanyIntelligence(profile);
assert.equal(v.available, true);
assert.equal(v.offeringType, "vertical_saas");
assert.equal(v.vertical, "ecommerce");
assert.equal(v.category, "SaaS for ecommerce");
assert.equal(v.confidence, "HIGH");
assert.ok(v.whatTheySell.length > 0);
assert.match(v.businessModel, /B2B/);
assert.ok(v.channels.includes("marketplace"));
assert.deepEqual(v.likelyBuyers.length > 0, true);
assert.equal(v.growth.hiringReal, true);
assert.ok(v.growth.signals.some((s) => s.kind === "funding"));
assert.ok(v.partnerships.some((p) => p.name === "Shopify"));
assert.equal(v.maturity.funding, true);
assert.equal(v.maturity.partnerships, true);
assert.ok(v.evidence.length >= 1 && v.evidence.length <= 6);
assert.equal(v.debug.engine, "hybrid");
assert.equal(v.debug.providerUsed, "exa");

console.log("PASS V2 company-intel CINT5 smoke (shared presenter view)");

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
