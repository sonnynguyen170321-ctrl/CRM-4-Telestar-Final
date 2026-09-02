// Audit fix smoke: company size must come from a real headcount (not a "small
// business" keyword that describes the target market), and growth signals must be
// de-duplicated/cleaned (no repeated-snippet "New Market" garbage).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { extractNeutralFacts, uniqueFactTokens } = loadTsModule("lib/v2/company-intelligence/extractFacts.ts");
const { presentCompanyIntelligence } = loadTsModule("lib/v2/company-intelligence/presentIntelligence.ts");
const { RuleReasoningEngine } = loadTsModule("lib/v2/company-intelligence/reasoning/ruleEngine.ts");

// 1. 354 employees + "serves small businesses" -> size band from the COUNT (not
//    SMALL), and "small businesses" becomes a target-market segment, not size.
{
  const facts = extractNeutralFacts([
    { url: "https://carrier.com.ph/about", path: "/about", text: "Concepcion-Carrier employs 354 people and serves small businesses across the Philippines." },
  ]);
  const tokens = uniqueFactTokens(facts);
  assert.ok(tokens.includes("size.employee_count_354"), "captures the real headcount");
  assert.ok(tokens.includes("size.range_MID_MARKET"), "354 -> MID_MARKET band (not SMALL)");
  assert.ok(!tokens.some((t) => t === "size.range_SMALL"), "never classifies a 354-person firm as SMALL");
  assert.ok(tokens.includes("market.segment_smb"), "'small businesses' -> target market, not company size");
}
console.log("PASS size: headcount drives the band; 'small businesses' is target market");

// 2. presenter surfaces a user-facing level + employees + target market.
{
  const view = presentCompanyIntelligence({
    id: "p1", companySummary: "Air conditioning.", facts: ["size.employee_count_354", "size.range_MID_MARKET", "market.segment_smb", "category.manufacturing"],
    factsByFamily: [], evidenceItems: [], evidenceByFamily: [],
    classification: { reasoning: null }, sourceCoverage: {}, riskSignals: [], confidence: {},
    profileStatus: "EXTRACTED", staleAt: null, researchVersion: 1, createdAt: new Date().toISOString(),
  });
  assert.equal(view.companySize.level, "Large", "354 employees -> Large (251-1000)");
  assert.equal(view.companySize.employees, 354);
  assert.deepEqual(view.targetMarket, ["SMB"], "target market surfaced separately");
}
console.log("PASS presenter: Size = Large · ~354 employees, Serves = SMB");

// 3. small startup count -> Startup level.
{
  const view = presentCompanyIntelligence({
    id: "p2", companySummary: "x", facts: ["size.employee_count_6"],
    factsByFamily: [], evidenceItems: [], evidenceByFamily: [],
    classification: {}, sourceCoverage: {}, riskSignals: [], confidence: {},
    profileStatus: "PARTIAL", staleAt: null, researchVersion: 1, createdAt: new Date().toISOString(),
  });
  assert.equal(view.companySize.level, "Startup");
}
console.log("PASS presenter: 6 employees -> Startup");

// 4. growth signal detail is de-duplicated + a bare "launches" no longer fires new_market.
{
  const engine = new RuleReasoningEngine();
  const reasoning = await engine.reason({
    companyName: "Carrier",
    canonicalDomain: "carrier.com.ph",
    country: "Philippines",
    pages: [{ url: "https://carrier.com.ph", pageType: "HOMEPAGE", title: "Carrier", metaDescription: "Air conditioning systems for businesses.", headings: ["Air conditioning"], mainText: "We provide air conditioning and HVAC systems." }],
    searchResults: [
      // duplicated title/highlight + a real expansion phrase.
      { url: "https://news/1", text: "Carrier expands into the Vietnam market Carrier expands into the Vietnam market this quarter", pageType: "SEARCH", provider: "exa" },
      // a bare product "launch" must NOT be classified as market expansion.
      { url: "https://news/2", text: "Carrier launches a new mobile app for scheduling", pageType: "SEARCH", provider: "exa" },
    ],
  });
  const market = reasoning.growth.signals.find((s) => s.kind === "new_market");
  assert.ok(market, "real 'expands into Vietnam market' is a new_market signal");
  const repeated = /(expands into the vietnam market).*\1/i.test(market.detail);
  assert.ok(!repeated, `detail must be de-duplicated, got: ${market.detail}`);
  assert.ok(market.detail.length <= 141, "detail is trimmed to one clause");
  assert.ok(!reasoning.growth.signals.some((s) => /mobile app/i.test(s.detail)), "a product launch is not a market-expansion signal");
}
console.log("PASS growth: cleaned + de-duplicated detail; tightened new_market");

console.log("PASS V2 intel size + growth audit fix");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    if (specifier.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
