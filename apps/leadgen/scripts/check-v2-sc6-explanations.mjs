import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { buildLeadScoreExplanation, buildScoreExplanation } = loadTsModule(
  "lib/v2/crm/scoreExplanationHelpers.ts"
);
const { extractNeutralFacts, uniqueFactTokens } = loadTsModule(
  "lib/v2/company-intelligence/extractFacts.ts"
);
const { mapNeutralFactsToCompanyEvidence } = loadTsModule(
  "lib/v2/company-intelligence/mapIntelligenceToCompanyEvidence.ts"
);

const explicitFacts = uniqueFactTokens(
  extractNeutralFacts([
    {
      url: "https://acme.example/about",
      path: "/about",
      text:
        "Acme is headquartered in Singapore with offices in Singapore and Vietnam. " +
        "The company has 250 employees, annual revenue of $2.5 million, and 3 locations.",
    },
    {
      url: "https://acme.example/customers",
      path: "/customers",
      text: "Acme is a mid-market SaaS platform trusted by leading banking customers.",
    },
  ])
);
assert.ok(explicitFacts.includes("size.employee_count_250"));
assert.ok(explicitFacts.includes("size.range_MID_MARKET"));
assert.ok(explicitFacts.includes("revenue.usd_2500000"));
assert.ok(explicitFacts.includes("geo.office_country_singapore"));
assert.ok(explicitFacts.includes("location.count_3"));
console.log("PASS SC6 extracts explicit size, revenue, office, and location facts");

const ambiguousFacts = uniqueFactTokens(
  extractNeutralFacts([
    {
      url: "https://ambiguous.example",
      path: "/",
      text: "Acme is a large global company with a growing team and growing revenue.",
    },
  ])
);
assert.ok(!ambiguousFacts.some((token) => token.startsWith("size.employee_count_")));
assert.ok(!ambiguousFacts.some((token) => token.startsWith("revenue.usd_")));
assert.ok(!ambiguousFacts.some((token) => token.startsWith("location.count_")));
console.log("PASS SC6 rejects ambiguous size, revenue, and location phrases");

const forbiddenEvidence = extractNeutralFacts([
  {
    url: "https://safe.example",
    path: "/",
    text: "The company has 50 employees and annual revenue of $1 million.",
  },
]);
for (const item of forbiddenEvidence) {
  const serialized = JSON.stringify(item).toLowerCase();
  assert.ok(!serialized.includes("qualification"));
  assert.ok(!serialized.includes("fitscore"));
  assert.ok(!serialized.includes("confidencescore"));
  assert.ok(!serialized.includes("final status"));
}
console.log("PASS SC6 fact extraction stays neutral");

const mappedEvidence = mapNeutralFactsToCompanyEvidence(explicitFacts, {
  sourceCoverageJson: { fetchStatus: "SUCCESS" },
});
assert.equal(mappedEvidence.employeeCount, 250);
assert.equal(mappedEvidence.employeeRange, "MID MARKET");
assert.equal(mappedEvidence.revenueUsd, 2500000);
assert.deepEqual(mappedEvidence.officeCountries, ["Singapore", "Vietnam"]);
assert.equal(mappedEvidence.locationCount, 3);
assert.equal(mappedEvidence.websiteStatus, "reachable");
assert.ok(mappedEvidence.productSignals.includes("SaaS"));
console.log("PASS SC6 maps explicit facts into rules-v2 company evidence");

const offlineEvidence = mapNeutralFactsToCompanyEvidence([], {
  sourceCoverageJson: { fetchStatus: "OFFLINE" },
  profileStatus: "FAILED",
});
assert.equal(offlineEvidence.websiteStatus, "offline");
const missingWebsiteEvidence = mapNeutralFactsToCompanyEvidence([], {
  sourceCoverageJson: { fetchStatus: "NO_WEBSITE" },
  profileStatus: "FAILED",
});
assert.equal(missingWebsiteEvidence.websiteStatus, "missing");
console.log("PASS SC6 maps explicit website status from source coverage only");

const rulesV2Assessment = {
  id: "assessment_rules_v2",
  fitScore: 86,
  confidence: 0.91,
  confidenceScore: 91,
  confidenceBand: "HIGH",
  qualification: "QUALIFIED",
  accountPreRank: "STRONG_ACCOUNT_FIT",
  companyType: null,
  reason: "Rules-v2 qualified",
  oneSentenceCompanySummary: null,
  scoringSource: "rules_v2_hard_rules",
  scoringVersion: "V2.SCORE-HV0:rules-v2.v1",
  inputFingerprint: "fingerprint",
  icpRulesHash: "rules_hash",
  previousAssessmentId: null,
  createdAt: new Date().toISOString(),
  evidenceSnapshotJson: {
    schemaVersion: "v2.score-hv0.evidence-snapshot.rules-v2.v1",
    accountFitScore: 88,
    subScores: { geo: 100, industry: 80, companyType: 90, size: 100, persona: 90, signals: 70 },
    dimensionResults: [
      {
        dimension: "size",
        score: 100,
        hits: [{ id: "size_in_range", label: "Headcount in range (250)", reasonCode: "target_size_match" }],
        missingEvidence: [],
      },
      {
        dimension: "persona",
        score: 90,
        hits: [{ id: "persona_allowed", label: "Allowed title", reasonCode: "persona_match" }],
        missingEvidence: [],
      },
    ],
    inputSnapshot: {
      companyEvidence: {
        companyName: "Acme",
        country: "Singapore",
        officeCountries: ["Singapore"],
        employeeCount: 250,
        revenueUsd: 2500000,
        websiteStatus: "reachable",
        locationCount: 3,
      },
      personaEvidence: {
        rawTitle: "Director of Sales",
        email: "director@acme.example",
      },
    },
    dictionaryVersions: { seniority: "seniority-v1", regions: "regions-v1" },
  },
  hardGateResultsJson: {
    schemaVersion: "v2.score-hv0.hard-gates.rules-v2.v1",
    hardDisqualifiersHit: [],
    disqualified: false,
  },
  confidenceBreakdownJson: {
    schemaVersion: "v2.score-hv0.confidence.rules-v2.v1",
    confidenceScore: 91,
    confidence: "HIGH",
  },
  dataQualityJson: {
    schemaVersion: "v2.score-hv0.data-quality.rules-v2.v1",
    reasonCodes: ["qualified"],
    reviewFlags: [],
    missingEvidence: [],
    requiredEvidenceMissing: [],
  },
};
const rulesV2Explanation = buildLeadScoreExplanation(rulesV2Assessment);
assert.equal(rulesV2Explanation.kind, "rules-v2");
assert.equal(rulesV2Explanation.headline.accountFitScore, 88);
assert.ok(rulesV2Explanation.dimensions.some((dimension) => dimension.key === "size" && dimension.score === 100));
assert.ok(rulesV2Explanation.accountEvidence.some(([label, value]) => label === "Employees" && value === "250"));
console.log("PASS SC6 builds structured rules-v2 lead explanation");

const gateAssessment = {
  ...rulesV2Assessment,
  qualification: "UNQUALIFIED",
  hardGateResultsJson: {
    hardDisqualifiersHit: [
      {
        id: "website_offline",
        label: "Website offline",
        reasonCode: "website_offline",
        evidence: "website status: offline",
      },
    ],
    disqualified: true,
  },
};
const gateExplanation = buildLeadScoreExplanation(gateAssessment);
assert.equal(gateExplanation.kind, "rules-v2");
assert.equal(gateExplanation.terminalGates[0].id, "website_offline");
console.log("PASS SC6 renders terminal gates from hardGateResultsJson");

const needsContactAssessment = {
  ...rulesV2Assessment,
  qualification: "COMPANY_QUALIFIED_NEEDS_CONTACT",
  dataQualityJson: {
    requiredEvidenceMissing: ["required_persona_title_missing"],
    missingEvidence: ["persona_title_missing"],
    reviewFlags: ["needs_human_review"],
    reasonCodes: [],
  },
};
const needsContactExplanation = buildLeadScoreExplanation(needsContactAssessment);
assert.equal(needsContactExplanation.kind, "rules-v2");
assert.ok(
  needsContactExplanation.reviewBlockers.some(
    (item) => item.label === "Required Persona Title Missing"
  )
);
console.log("PASS SC6 renders required evidence blockers from dataQualityJson");

const malformedExplanation = buildLeadScoreExplanation({
  ...rulesV2Assessment,
  evidenceSnapshotJson: "not-json",
  hardGateResultsJson: null,
  dataQualityJson: null,
});
assert.equal(malformedExplanation.kind, "rules-v2");
assert.equal(malformedExplanation.terminalGates.length, 0);
assert.equal(malformedExplanation.reviewBlockers.length, 0);
console.log("PASS SC6 malformed rules-v2 snapshots degrade safely");

const legacyGroups = buildScoreExplanation({
  ...rulesV2Assessment,
  scoringVersion: "V2.SCORE-HV0:icp1r.v1",
  dataQualityJson: {
    reviewFlags: ["needs_human_review"],
    missingEvidence: ["explicit_geo_missing"],
    reasonCodes: ["country_missing"],
  },
  hardGateResultsJson: {
    hardDisqualifiersHit: [{ id: "excluded_country", label: "Excluded country", evidenceSource: "country" }],
  },
});
assert.ok(legacyGroups.some((group) => group.label === "Flags & reasons"));
assert.ok(legacyGroups.some((group) => group.label === "Hard disqualifiers"));
console.log("PASS SC6 legacy explanation remains compatible");

console.log("PASS SC6 explanation and evidence smoke checks complete");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = require("node:fs").readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: absolutePath,
  }).outputText;

  const cjsModule = { exports: {} };
  moduleCache.set(absolutePath, cjsModule);
  const localRequire = (specifier) => {
    if (specifier.startsWith(".")) {
      const resolved = resolve(dirname(absolutePath), specifier);
      const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`];
      for (const candidate of candidates) {
        if (require("node:fs").existsSync(candidate)) {
          return loadTsModule(candidate.slice(rootDir.length + 1));
        }
      }
    }

    return require(specifier);
  };

  const fn = new Function("require", "module", "exports", output);
  fn(localRequire, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
