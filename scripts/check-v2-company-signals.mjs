// P1 company-drawer signals smoke — pure derivation over an IntelligenceView.
// Proves the status pill / health / positive / watch-out logic reflects real data
// only (no invented fields), and that research-status problems surface as watch-outs.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { deriveCompanySignals } = loadTsModule("lib/v2/company-intelligence/companySignals.ts");

function view(overrides = {}) {
  return {
    available: true,
    companySummary: "Acme sells widgets.",
    offeringType: "software",
    vertical: "logistics",
    category: "Logistics",
    confidence: "MEDIUM",
    whatTheySell: ["widgets"],
    businessModel: "B2B",
    channels: ["direct"],
    likelyBuyers: ["Ops"],
    growth: { hiringReal: false, signals: [] },
    partnerships: [],
    maturity: { customers: false, partnerships: false, funding: false, hiring: false },
    evidence: [],
    debug: {},
    profileStatus: "EXTRACTED",
    staleAt: null,
    ...overrides,
  };
}

// 1. Healthy: extracted + medium confidence -> green "Healthy".
{
  const s = deriveCompanySignals({ view: view(), researchStatus: "SUCCESS", profileStatus: "EXTRACTED", leadAssignmentCount: 2 });
  assert.equal(s.statusPill.label, "Healthy");
  assert.equal(s.statusPill.tone, "green");
  assert.equal(s.health.length, 5, "five health rows");
}
console.log("PASS status pill = Healthy for extracted + confident");

// 2. Research issue dominates -> red, and surfaces a watch-out.
{
  const s = deriveCompanySignals({ view: view({ available: false }), researchStatus: "BLOCKED", profileStatus: null, leadAssignmentCount: 0 });
  assert.equal(s.statusPill.tone, "red");
  assert.ok(s.watchOuts.some((w) => /blocked/i.test(w)), "blocked surfaces a watch-out");
  assert.ok(s.watchOuts.some((w) => /no active leadassignments/i.test(w)));
}
console.log("PASS research issue -> red pill + watch-outs");

// 3. Positive signals reflect real growth/maturity only.
{
  const s = deriveCompanySignals({
    view: view({
      growth: { hiringReal: true, signals: [{ kind: "funding_round", detail: "Series A" }] },
      maturity: { customers: true, partnerships: true, funding: true, hiring: true },
    }),
    researchStatus: "SUCCESS",
    profileStatus: "EXTRACTED",
    leadAssignmentCount: 3,
  });
  assert.ok(s.positive.some((p) => /hiring/i.test(p)), "hiring positive");
  assert.ok(s.positive.some((p) => /Funding Round/i.test(p)), "funding signal formatted");
  assert.ok(s.positive.some((p) => /customer proof/i.test(p)));
  assert.equal(s.health.find((h) => h.label === "Hiring intent").tone, "green");
}
console.log("PASS positive signals + health derive from real growth/maturity");

// 4. Low confidence + no offering -> amber pill + advisory watch-outs.
{
  const s = deriveCompanySignals({
    view: view({ confidence: "LOW", whatTheySell: [], profileStatus: "PARTIAL" }),
    researchStatus: "JS_RENDER_REQUIRED",
    profileStatus: "PARTIAL",
    leadAssignmentCount: 1,
  });
  assert.equal(s.statusPill.tone, "amber");
  assert.ok(s.watchOuts.some((w) => /JS render/i.test(w)));
  assert.ok(s.watchOuts.some((w) => /low evidence/i.test(w)));
  assert.ok(s.watchOuts.some((w) => /not clearly identified/i.test(w)));
}
console.log("PASS low-confidence + partial -> amber + advisory watch-outs");

console.log("PASS V2 company signals (P1 premium drawer)");

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
