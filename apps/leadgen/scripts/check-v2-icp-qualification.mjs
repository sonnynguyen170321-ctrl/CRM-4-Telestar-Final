import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SC3 smoke: prove schema-v2 gates + dimension subScores derive canonical V2
// qualification, fit/confidence metrics, and accountPreRank without DB/network/AI.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { assessIcpRulesV2 } = loadTsModule("lib/v2/scoring/rules/deriveQualification.ts");
const {
  ALISON,
  STORMWALL,
  TELESTAR,
} = loadTsModule("lib/v2/scoring/__fixtures__/icpCorpus/index.ts");

const saasProductCompany = (over = {}) => ({
  companyName: "Northstar Labs",
  domain: "northstar.io",
  country: "United States",
  industry: "B2B SaaS",
  employeeCount: 80,
  companyType: "PRODUCT_SAAS",
  websiteStatus: "reachable",
  evidenceText: "B2B SaaS platform software product",
  ...over,
});

const cases = [
  {
    name: "clean full ICP fit",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany(),
      contact: { rawTitle: "Director of Sales", email: "jane@northstar.io" },
    },
    expect: {
      qualification: "QUALIFIED",
      accountPreRank: "STRONG_ACCOUNT_FIT",
      confidenceBand: "HIGH",
      minFitScore: 75,
      reasonCodes: ["fit_score_qualified"],
    },
  },
  {
    name: "terminal generic email",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany(),
      contact: { rawTitle: "Director of Sales", email: "jane@gmail.com" },
    },
    expect: {
      qualification: "UNQUALIFIED",
      accountPreRank: "CLEAR_MISMATCH",
      gateIds: ["generic_email_contact"],
      reasonCodes: ["terminal_gate"],
    },
  },
  {
    name: "company fit but missing contact",
    icp: TELESTAR,
    evidence: {
      company: saasProductCompany(),
    },
    expect: {
      qualification: "COMPANY_QUALIFIED_NEEDS_CONTACT",
      accountPreRank: "STRONG_ACCOUNT_FIT",
      requiredEvidenceMissing: ["required_persona_title_missing"],
      reasonCodes: ["company_fit_needs_contact"],
    },
  },
  {
    name: "account plausible but persona denied",
    icp: ALISON,
    evidence: {
      company: {
        companyName: "EdReach",
        country: "United States",
        industry: "Education",
      },
      contact: { rawTitle: "Marketing Manager", email: "m@edreach.com" },
    },
    expect: {
      qualification: "NEEDS_REVIEW",
      accountPreRank: "STRONG_ACCOUNT_FIT",
      maxPersonaScore: 0,
      reasonCodes: ["fit_score_needs_review"],
    },
  },
  {
    name: "clear low-score mismatch",
    icp: TELESTAR,
    evidence: {
      company: {
        companyName: "Tiny Offshore Services",
        country: "Brazil",
        industry: "Local cleaning",
        companyType: "SERVICE_PLUS_PRODUCT",
        websiteStatus: "reachable",
        evidenceText: "local cleaning franchise",
      },
      contact: { rawTitle: "Junior Analyst", email: "ops@tiny.example" },
    },
    expect: {
      qualification: "UNQUALIFIED",
      reasonCodes: ["fit_score_unqualified"],
    },
  },
  {
    name: "same India ISP differs by ICP",
    icp: STORMWALL,
    evidence: {
      company: {
        companyName: "IndNet ISP",
        country: "India",
        industry: "ISP telecom",
        employeeCount: 400,
        evidenceText: "ISP telecom network protection",
      },
      contact: { rawTitle: "CISO", email: "ciso@indnet.in" },
    },
    expect: {
      qualification: "QUALIFIED",
      accountPreRank: "STRONG_ACCOUNT_FIT",
      minFitScore: 75,
    },
  },
];

for (const testCase of cases) {
  const assessment = assessIcpRulesV2(testCase.evidence, testCase.icp);
  const label = `[${testCase.icp.ruleSetId}] ${testCase.name}`;

  assert.equal(assessment.qualification, testCase.expect.qualification, `${label} qualification`);
  assert.ok(!JSON.stringify(assessment).includes("UNCERTAIN"), `${label} never emits UNCERTAIN`);
  assert.ok(assessment.fitScore >= 0 && assessment.fitScore <= 100, `${label} fitScore range`);
  assert.ok(assessment.confidenceScore >= 0 && assessment.confidenceScore <= 100, `${label} confidence range`);

  if (testCase.expect.accountPreRank) {
    assert.equal(assessment.accountPreRank, testCase.expect.accountPreRank, `${label} accountPreRank`);
  }
  if (testCase.expect.confidenceBand) {
    assert.equal(assessment.confidenceBand, testCase.expect.confidenceBand, `${label} confidenceBand`);
  }
  if (testCase.expect.minFitScore !== undefined) {
    assert.ok(assessment.fitScore >= testCase.expect.minFitScore, `${label} fitScore >= ${testCase.expect.minFitScore}`);
  }
  if (testCase.expect.maxPersonaScore !== undefined) {
    assert.ok(
      assessment.subScores.persona <= testCase.expect.maxPersonaScore,
      `${label} persona <= ${testCase.expect.maxPersonaScore}`
    );
  }
  for (const gateId of testCase.expect.gateIds ?? []) {
    assert.ok(
      assessment.gates.hits.some((hit) => hit.id === gateId),
      `${label} expected gate ${gateId}`
    );
  }
  for (const missing of testCase.expect.requiredEvidenceMissing ?? []) {
    assert.ok(
      assessment.requiredEvidenceMissing.includes(missing),
      `${label} expected requiredEvidenceMissing ${missing}`
    );
  }
  for (const reasonCode of testCase.expect.reasonCodes ?? []) {
    assert.ok(
      assessment.reasonCodes.includes(reasonCode),
      `${label} expected reasonCode ${reasonCode}`
    );
  }
}

console.log(`PASS ${cases.length} SC3 qualification cases`);

const teleStarIndia = assessIcpRulesV2(
  {
    company: {
      companyName: "IndNet ISP",
      country: "India",
      industry: "ISP telecom",
      employeeCount: 400,
    },
    contact: { rawTitle: "CISO", email: "ciso@indnet.in" },
  },
  TELESTAR
);
assert.equal(teleStarIndia.qualification, "UNQUALIFIED", "TeleStar excludes India");
assert.ok(
  teleStarIndia.gates.hits.some((hit) => hit.id === "excluded_country"),
  "TeleStar India has excluded_country gate"
);
console.log("PASS cross-ICP qualification inversion");

const sc3SourceFiles = [
  "lib/v2/scoring/rules/deriveQualification.ts",
  "scripts/check-v2-icp-qualification.mjs",
];
const sc3Source = sc3SourceFiles
  .map((file) => readFileSync(resolve(rootDir, file), "utf8"))
  .join("\n");

for (const fragment of ["@prisma" + "/client", "fetch" + "(", "op" + "enai", "anth" + "ropic", "gem" + "ini"]) {
  assert.equal(
    sc3Source.toLowerCase().includes(fragment.toLowerCase()),
    false,
    `forbidden fragment ${fragment} should not appear in SC3 module`
  );
}
assert.equal(
  /from\s+["'][^"']*\/scoring\/(assessCompanyAgainstIcp|deriveQualification|evaluateHardGates|computeFitScore)/.test(sc3Source),
  false,
  "SC3 must not import the legacy scoring runtime"
);
console.log("PASS no live AI/network/Prisma/legacy-runtime imports in SC3 module");
console.log("PASS V2 ICP qualification SC3 smoke");

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
