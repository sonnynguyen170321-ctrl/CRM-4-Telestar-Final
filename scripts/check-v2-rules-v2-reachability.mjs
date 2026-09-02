import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SC5.1 anti-leakage guard: prove the rules-v2 scoring engine is REACHABLE and the
// load->qualify->drawer workflow links end-to-end. This is the guard that would have
// caught "engine built (SC1-SC6) but no human path produces a v2 ICP, so the UI never
// changes". Pure: no DB, no network, no provider calls.
//
// Chain proven:
//   authoring upgradeSourceRulesToV2 (v1 -> valid v2)         [v2 is reachable]
//   -> assessIcpRulesV2 (real scoring)
//   -> mapRulesV2AssessmentToPersistence (REAL persisted shape)
//   -> buildLeadScoreExplanation -> kind "rules-v2"            [drawer renders rules-v2]
//   and a non-v2 assessment -> kind "legacy"                   [dispatch is real, not always-v2]

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const RULES_V2_SCORING_VERSION = "V2.SCORE-HV0:rules-v2.v1";

const { upgradeSourceRulesToV2 } = loadTsModule("lib/v2/icp/authoring.ts");
const { validateIcpVersionRulesV2 } = loadTsModule("lib/v2/scoring/rules/schema-v2.ts");
const { assessIcpRulesV2 } = loadTsModule("lib/v2/scoring/rules/deriveQualification.ts");
const { mapRulesV2AssessmentToPersistence } = loadTsModule(
  "lib/v2/scoring/runtime/mapIcpAssessmentToPersistence.ts"
);
const { buildLeadScoreExplanation } = loadTsModule("lib/v2/crm/scoreExplanationHelpers.ts");
const { TELESTAR } = loadTsModule("lib/v2/scoring/__fixtures__/icpCorpus/index.ts");
const { TELESTAR_SAAS_OUTBOUND_ICP_RULES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/sampleIcpRules.ts"
);

// ---------------------------------------------------------------------------
// 1. The authoring upgrade producer makes v2 REACHABLE from a v1 ICP
// ---------------------------------------------------------------------------

const upgraded = upgradeSourceRulesToV2(TELESTAR_SAAS_OUTBOUND_ICP_RULES);
assert.equal(upgraded.alreadyV2, false, "v1 source is reported as not-yet-v2");
assert.equal(upgraded.rules.schemaVersion, "v2", "upgrade produces schemaVersion v2");
validateIcpVersionRulesV2(upgraded.rules); // throws if invalid
assert.ok(upgraded.rules.geography.excludedCountries.includes("India"), "v1 geography carried over");

// already-v2 input is revalidated, not double-lifted
const passthrough = upgradeSourceRulesToV2(TELESTAR);
assert.equal(passthrough.alreadyV2, true, "v2 source is reported as already-v2");
assert.equal(passthrough.rules.schemaVersion, "v2");

console.log("PASS authoring upgradeSourceRulesToV2 makes rules-v2 reachable from a v1 ICP");

// ---------------------------------------------------------------------------
// 2. A v2 ICP scored flows through the REAL persistence shape into the rules-v2 drawer
// ---------------------------------------------------------------------------

function persistedToWorkspace(persisted, assessment) {
  // Shape the persisted columns into the LeadWorkspaceAssessment the drawer reads.
  return {
    scoringVersion: persisted.scoringVersion,
    qualification: persisted.qualification,
    fitScore: persisted.fitScore,
    accountPreRank: persisted.accountPreRank,
    confidenceBand: assessment.confidenceBand,
    confidenceScore: assessment.confidenceScore,
    evidenceSnapshotJson: persisted.evidenceSnapshotJson,
    hardGateResultsJson: persisted.hardGateResultsJson,
    confidenceBreakdownJson: persisted.confidenceBreakdownJson,
    dataQualityJson: persisted.dataQualityJson,
  };
}

function scoreToDrawer(raw, rules) {
  const assessment = assessIcpRulesV2(raw, rules);
  const persisted = mapRulesV2AssessmentToPersistence({
    scoringInput: {
      icpRules: rules,
      companyEvidence: raw.company,
      personaEvidence: raw.contact ?? null,
      contactIdentifiers: {},
      leadAssignment: { id: "la_guard", organizationId: "org_guard" },
      icpVersion: { id: "icpv_guard", versionNumber: 1, version: 1 },
      company: raw.company,
      contact: raw.contact ?? null,
    },
    assessment,
  });
  // The persisted assessment must carry the rules-v2 scoring version (the drawer key).
  assert.equal(
    persisted.scoringVersion,
    RULES_V2_SCORING_VERSION,
    "rules-v2 persistence stamps the rules-v2 scoring version"
  );
  const explanation = buildLeadScoreExplanation(persistedToWorkspace(persisted, assessment));
  return { assessment, persisted, explanation };
}

const cleanCompany = {
  companyName: "Northstar Labs",
  domain: "northstar.io",
  country: "United States",
  industry: "B2B SaaS",
  employeeCount: 80,
  companyType: "PRODUCT_SAAS",
  websiteStatus: "reachable",
  evidenceText: "b2b saas platform software product",
};

const qualified = scoreToDrawer(
  { company: cleanCompany, contact: { rawTitle: "Director of Sales", email: "jane@northstar.io" } },
  TELESTAR
);
assert.equal(qualified.assessment.qualification, "QUALIFIED");
assert.equal(qualified.explanation.kind, "rules-v2", "QUALIFIED v2 lead renders the rules-v2 drawer");
assert.ok(qualified.explanation.dimensions.length >= 6, "drawer shows per-dimension subScores");

const gmail = scoreToDrawer(
  { company: cleanCompany, contact: { rawTitle: "Director of Sales", email: "jane@gmail.com" } },
  TELESTAR
);
assert.equal(gmail.assessment.qualification, "UNQUALIFIED");
assert.equal(gmail.explanation.kind, "rules-v2");
assert.ok(
  gmail.explanation.terminalGates.some((gate) => gate.reasonCode === "generic_email_contact"),
  "drawer shows the generic-email terminal gate"
);

const needsContact = scoreToDrawer({ company: cleanCompany }, TELESTAR);
assert.equal(needsContact.assessment.qualification, "COMPANY_QUALIFIED_NEEDS_CONTACT");
assert.equal(needsContact.explanation.kind, "rules-v2");

console.log("PASS v2 ICP scores -> real persisted shape -> rules-v2 drawer (QUALIFIED / gate / needs-contact)");

// ---------------------------------------------------------------------------
// 3. A non-v2 assessment renders the LEGACY drawer (dispatch is real)
// ---------------------------------------------------------------------------

const legacyAssessment = {
  scoringVersion: "V2.SCORE-HV0:icp1r.v1",
  qualification: "QUALIFIED",
  fitScore: 80,
  confidenceBand: "HIGH",
  accountPreRank: "STRONG_ACCOUNT_FIT",
  confidenceScore: 80,
  evidenceSnapshotJson: { evidenceSummary: ["legacy evidence"] },
  hardGateResultsJson: { hardDisqualifiersHit: [] },
  confidenceBreakdownJson: { confidence: "HIGH" },
  dataQualityJson: { reasonCodes: ["final_qualified"], missingEvidence: [], reviewFlags: [] },
};
const legacyExplanation = buildLeadScoreExplanation(legacyAssessment);
assert.equal(legacyExplanation.kind, "legacy", "non-v2 assessment renders the legacy drawer");

console.log("PASS non-v2 assessment renders the legacy drawer (rules-v2 dispatch is real, not always-on)");
console.log("PASS V2 rules-v2 reachability + end-to-end linkage guard");

// ---------------------------------------------------------------------------
// loader (handles server-only shim + @/ alias + index resolution)
// ---------------------------------------------------------------------------

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) {
      return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    }
    if (specifier.startsWith(".")) {
      return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    }
    return require(specifier);
  };

  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  // fall back to node resolution for non-TS deps
  return require(base);
}
