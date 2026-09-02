import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SC2 smoke: prove normalize + terminal gates + per-dimension scorers behave on the
// 18-ICP golden corpus, and that the same company scores differently across ICPs.
// Pure: no DB, no network, no provider calls.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { normalizeEvidence } = loadTsModule("lib/v2/scoring/rules/normalize/index.ts");
const { evaluateTerminalGates } = loadTsModule("lib/v2/scoring/rules/gates/terminalGates.ts");
const { scoreDimensions } = loadTsModule("lib/v2/scoring/rules/dimensions/index.ts");
const { validateIcpVersionRulesV2 } = loadTsModule("lib/v2/scoring/rules/schema-v2.ts");
const { ICP_CORPUS, STORMWALL, TELESTAR, ONECLOUDHUB, ALISON } = loadTsModule(
  "lib/v2/scoring/__fixtures__/icpCorpus/index.ts"
);
const { GOLDEN_CASES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/icpCorpus/goldenCases.ts"
);

// ---------------------------------------------------------------------------
// 1. All 18 corpus ICPs are valid schema-v2
// ---------------------------------------------------------------------------

assert.equal(ICP_CORPUS.length, 18, "corpus has all 18 ICPs");
const seenRuleSetIds = new Set();
for (const icp of ICP_CORPUS) {
  const parsed = validateIcpVersionRulesV2(icp);
  assert.equal(parsed.schemaVersion, "v2");
  assert.equal(seenRuleSetIds.has(parsed.ruleSetId), false, `unique ruleSetId ${parsed.ruleSetId}`);
  seenRuleSetIds.add(parsed.ruleSetId);
}
console.log(`PASS all ${ICP_CORPUS.length} corpus ICPs validate as schema-v2`);

// ---------------------------------------------------------------------------
// 2. Golden cases: gates + dimension subScores + missingEvidence
// ---------------------------------------------------------------------------

function runCase(icp, evidence) {
  const normalized = normalizeEvidence(evidence);
  const gates = evaluateTerminalGates(normalized, icp);
  const dimensions = scoreDimensions(normalized, icp);
  return { gates, dimensions };
}

for (const golden of GOLDEN_CASES) {
  const { gates, dimensions } = runCase(golden.icp, golden.evidence);
  const gateIds = gates.hits.map((hit) => hit.id);
  const label = `[${golden.icp.ruleSetId}] ${golden.name}`;

  if (golden.expect.disqualified !== undefined) {
    assert.equal(gates.disqualified, golden.expect.disqualified, `${label} disqualified`);
  }
  for (const gateId of golden.expect.gateIdsInclude ?? []) {
    assert.ok(gateIds.includes(gateId), `${label} expected gate ${gateId} (got ${gateIds.join(",") || "none"})`);
  }
  for (const [dim, min] of Object.entries(golden.expect.subScoreAtLeast ?? {})) {
    assert.ok(
      dimensions.subScores[dim] >= min,
      `${label} ${dim} >= ${min} (got ${dimensions.subScores[dim]})`
    );
  }
  for (const [dim, max] of Object.entries(golden.expect.subScoreAtMost ?? {})) {
    assert.ok(
      dimensions.subScores[dim] <= max,
      `${label} ${dim} <= ${max} (got ${dimensions.subScores[dim]})`
    );
  }
  for (const missing of golden.expect.missingEvidenceInclude ?? []) {
    assert.ok(
      dimensions.missingEvidence.includes(missing),
      `${label} expected missingEvidence ${missing} (got ${dimensions.missingEvidence.join(",") || "none"})`
    );
  }

  // every subScore is an integer-ish 0..100
  for (const value of Object.values(dimensions.subScores)) {
    assert.ok(value >= 0 && value <= 100, `${label} subScore in range`);
  }
}
console.log(`PASS ${GOLDEN_CASES.length} golden cases (gates + dimension subScores + missingEvidence)`);

// ---------------------------------------------------------------------------
// 3. Cross-ICP determinism — same company, different ICP, different outcome
// ---------------------------------------------------------------------------

// India ISP: TARGET geography for Stormwall, TERMINAL EXCLUSION for TeleStar.
const indiaCompany = {
  company: { companyName: "IndNet ISP", country: "India", industry: "ISP telecom", employeeCount: 400 },
  contact: { rawTitle: "CISO", email: "ciso@indnet.in" },
};
const stormwallIndia = runCase(STORMWALL, indiaCompany);
const telestarIndia = runCase(TELESTAR, indiaCompany);
assert.equal(stormwallIndia.gates.disqualified, false, "Stormwall: India not disqualified");
assert.ok(stormwallIndia.dimensions.subScores.geo >= 100, "Stormwall: India geo target");
assert.equal(telestarIndia.gates.disqualified, true, "TeleStar: India disqualified");
assert.ok(
  telestarIndia.gates.hits.some((hit) => hit.id === "excluded_country"),
  "TeleStar: India excluded_country gate"
);

// Singapore IT Director: persona fit for 1CloudHub, geo miss for Alison (NA only).
const sgItDirector = {
  company: { companyName: "SgInfra", country: "Singapore", industry: "Cloud infrastructure", employeeCount: 120 },
  contact: { rawTitle: "Director of IT", email: "it@sginfra.sg" },
};
const cloudhubSg = runCase(ONECLOUDHUB, sgItDirector);
const alisonSg = runCase(ALISON, sgItDirector);
assert.ok(cloudhubSg.dimensions.subScores.geo >= 100, "1CloudHub: Singapore geo match");
assert.ok(cloudhubSg.dimensions.subScores.persona >= 100, "1CloudHub: IT Director persona match");
assert.ok(alisonSg.dimensions.subScores.geo <= 10, "Alison: Singapore geo miss");

console.log("PASS cross-ICP determinism (India geo inversion; SG persona vs geo)");

// ---------------------------------------------------------------------------
// 4. No live AI / network / Prisma / V1 business imports in SC2 module
// ---------------------------------------------------------------------------

const sc2SourceFiles = [
  "lib/v2/scoring/rules/evidence.ts",
  "lib/v2/scoring/rules/normalize/index.ts",
  "lib/v2/scoring/rules/normalize/normalizeCountry.ts",
  "lib/v2/scoring/rules/normalize/normalizeTitle.ts",
  "lib/v2/scoring/rules/normalize/normalizeSize.ts",
  "lib/v2/scoring/rules/normalize/normalizeEmail.ts",
  "lib/v2/scoring/rules/gates/terminalGates.ts",
  "lib/v2/scoring/rules/dimensions/index.ts",
  "lib/v2/scoring/rules/dimensions/geoScore.ts",
  "lib/v2/scoring/rules/dimensions/industryScore.ts",
  "lib/v2/scoring/rules/dimensions/companyTypeScore.ts",
  "lib/v2/scoring/rules/dimensions/sizeScore.ts",
  "lib/v2/scoring/rules/dimensions/personaScore.ts",
  "lib/v2/scoring/rules/dimensions/signalScore.ts",
  "lib/v2/scoring/__fixtures__/icpCorpus/defineIcp.ts",
  "lib/v2/scoring/__fixtures__/icpCorpus/index.ts",
  "lib/v2/scoring/__fixtures__/icpCorpus/goldenCases.ts",
  "scripts/check-v2-icp-dimensions.mjs",
];
const sc2Source = sc2SourceFiles
  .map((file) => readFileSync(resolve(rootDir, file), "utf8"))
  .join("\n");

const forbiddenFragments = ["@prisma" + "/client", "fetch" + "(", "op" + "enai", "anth" + "ropic", "gem" + "ini"];
for (const fragment of forbiddenFragments) {
  assert.equal(
    sc2Source.toLowerCase().includes(fragment.toLowerCase()),
    false,
    `forbidden fragment ${fragment} should not appear in SC2 module`
  );
}
// must not import the V1 scoring runtime
assert.equal(
  /from\s+["'][^"']*\/scoring\/(assessCompanyAgainstIcp|deriveQualification|evaluateHardGates|computeFitScore)/.test(sc2Source),
  false,
  "SC2 must not import the V1 scoring runtime"
);

console.log("PASS no live AI/network/Prisma/V1-runtime imports in SC2 module");
console.log("PASS V2 ICP dimensions + gates SC2 smoke");

// ---------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);

  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    const resolvedPath = resolve(dirname(absolutePath), `${specifier}.ts`);
    const relativeToRoot = resolvedPath.slice(rootDir.length + 1);

    return loadTsModule(relativeToRoot);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}
