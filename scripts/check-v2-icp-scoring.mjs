import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { assessCompanyAgainstIcp } = loadTsModule(
  "lib/v2/scoring/assessCompanyAgainstIcp.ts"
);
const { validateIcpVersionRules } = loadTsModule(
  "lib/v2/scoring/icpRulesSchema.ts"
);
const {
  LOYALTY_PLATFORM_COMPANY,
  SAMPLE_ICP_BENCHMARK_CASES,
} = loadTsModule("lib/v2/scoring/__fixtures__/sampleIcpBenchmarkCases.ts");
const {
  MANUFACTURING_ERP_BUYER_ICP_RULES,
  STRATOVA_CXO_ICP_RULES,
  TELESTAR_SDR_OUTSOURCING_ICP_RULES,
} = loadTsModule("lib/v2/scoring/__fixtures__/sampleIcpRules.ts");

const assessments = [];

for (const fixture of SAMPLE_ICP_BENCHMARK_CASES) {
  const result = assessCompanyAgainstIcp(
    fixture.companyEvidence,
    fixture.icpRules,
    fixture.personaEvidence
  );
  assessments.push({ fixture, result });

  console.log(
    `[${fixture.icpRules.ruleSetId}] ${fixture.companyEvidence.companyName} -> ${result.qualification} (${result.fitScore}/${result.confidenceScore})`
  );

  assert.equal(result.qualification, fixture.expected.qualification, fixture.name);
  assert.ok(Number.isInteger(result.fitScore), `${fixture.name} fitScore integer`);
  assert.ok(result.fitScore >= 0 && result.fitScore <= 100, `${fixture.name} fitScore range`);
  assert.ok(
    Number.isInteger(result.confidenceScore),
    `${fixture.name} confidenceScore integer`
  );
  assert.ok(
    result.confidenceScore >= 0 && result.confidenceScore <= 100,
    `${fixture.name} confidenceScore range`
  );
  assert.ok(result.shortReason.length > 0, `${fixture.name} shortReason present`);
  assert.ok(result.evidenceSummary.length > 0, `${fixture.name} evidenceSummary present`);
  assert.ok(result.reasonCodes.length > 0, `${fixture.name} reasonCodes present`);
  assert.notEqual(result.qualification, "uncertain", `${fixture.name} no uncertain output`);
  assert.equal(
    "qualifiedThreshold" in result.rulesSnapshot.scorePolicy,
    false,
    `${fixture.name} no old qualifiedThreshold`
  );
  assert.equal(
    "unqualifiedThreshold" in result.rulesSnapshot.scorePolicy,
    false,
    `${fixture.name} no old unqualifiedThreshold`
  );

  if (fixture.expected.minFitScore !== undefined) {
    assert.ok(
      result.fitScore >= fixture.expected.minFitScore,
      `${fixture.name} expected min fitScore`
    );
  }

  if (fixture.expected.maxFitScore !== undefined) {
    assert.ok(
      result.fitScore <= fixture.expected.maxFitScore,
      `${fixture.name} expected max fitScore`
    );
  }

  for (const missingEvidence of fixture.expected.missingEvidenceIncludes ?? []) {
    assert.ok(
      result.missingEvidence.includes(missingEvidence),
      `${fixture.name} expected missing evidence ${missingEvidence}`
    );
  }

  for (const reasonCode of fixture.expected.reasonCodesInclude ?? []) {
    assert.ok(
      result.reasonCodes.includes(reasonCode),
      `${fixture.name} expected reason code ${reasonCode}`
    );
  }

  if (fixture.expected.accountPreRankNot !== undefined) {
    assert.notEqual(
      result.accountPreRank,
      fixture.expected.accountPreRankNot,
      `${fixture.name} account pre-rank should differ`
    );
  }

  if (fixture.expected.accountPreRankOneOf !== undefined) {
    assert.ok(
      fixture.expected.accountPreRankOneOf.includes(result.accountPreRank),
      `${fixture.name} account pre-rank should be one of expected values`
    );
  }

  if (fixture.expected.neverQualified === true) {
    assert.notEqual(
      result.qualification,
      "QUALIFIED",
      `${fixture.name} must not final qualify`
    );
  }
}

const sameCompanyAssessments = [
  assessCompanyAgainstIcp(
    LOYALTY_PLATFORM_COMPANY,
    TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    {
      rawTitle: "Chief Revenue Officer",
      title: "Chief Revenue Officer",
      seniorityTier: "C_LEVEL",
    }
  ),
  assessCompanyAgainstIcp(
    LOYALTY_PLATFORM_COMPANY,
    MANUFACTURING_ERP_BUYER_ICP_RULES,
    {
      rawTitle: "Chief Revenue Officer",
      title: "Chief Revenue Officer",
      seniorityTier: "C_LEVEL",
    }
  ),
  assessCompanyAgainstIcp(LOYALTY_PLATFORM_COMPANY, STRATOVA_CXO_ICP_RULES),
];

assert.ok(
  new Set(sameCompanyAssessments.map((result) => result.qualification)).size >= 2,
  "same company should produce different qualifications across ICPs"
);
assert.ok(
  new Set(sameCompanyAssessments.map((result) => result.fitScore)).size >= 2,
  "same company should produce different fit scores across ICPs"
);

const companyOnlyPersonaSensitive = sameCompanyAssessments[2];
assert.equal(companyOnlyPersonaSensitive.qualification, "NEEDS_REVIEW");
assert.notEqual(companyOnlyPersonaSensitive.qualification, "QUALIFIED");
assert.ok(
  companyOnlyPersonaSensitive.missingEvidence.includes(
    "target_persona_missing_required"
  )
);

const invalidOldPolicy = {
  ...TELESTAR_SDR_OUTSOURCING_ICP_RULES,
  scorePolicy: {
    minScore: 0,
    maxScore: 100,
    qualifiedThreshold: 75,
    unqualifiedThreshold: 35,
  },
};
assert.throws(() => validateIcpVersionRules(invalidOldPolicy));
assert.throws(() =>
  validateIcpVersionRules({
    ...TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    confidencePolicy: {
      highConfidenceThreshold: 0.7,
      mediumConfidenceThreshold: 0.45,
    },
  })
);
assert.throws(() =>
  validateIcpVersionRules({
    ...TELESTAR_SDR_OUTSOURCING_ICP_RULES,
    scoringWeights: {
      ...TELESTAR_SDR_OUTSOURCING_ICP_RULES.scoringWeights,
      positiveSignals: 11,
    },
  })
);

const sourceToCheck = [
  "lib/v2/scoring/icpRulesSchema.ts",
  "lib/v2/scoring/assessCompanyAgainstIcp.ts",
  "lib/v2/scoring/__fixtures__/sampleIcpRules.ts",
  "lib/v2/scoring/__fixtures__/sampleIcpBenchmarkCases.ts",
  "scripts/check-v2-icp-scoring.mjs",
]
  .map((file) => readFileSync(resolve(rootDir, file), "utf8"))
  .join("\n");

const forbiddenFragments = [
  "@prisma" + "/client",
  "fetch" + "(",
  "op" + "enai",
  "anth" + "ropic",
  "gem" + "ini",
];

for (const fragment of forbiddenFragments) {
  assert.equal(
    sourceToCheck.toLowerCase().includes(fragment.toLowerCase()),
    false,
    `forbidden fragment ${fragment} should not appear`
  );
}

const forbiddenImportPatterns = [
  new RegExp("from\\s+[\"'].*lib" + "\\/scoring"),
  new RegExp("from\\s+[\"'].*activity" + "Recaps"),
];

for (const pattern of forbiddenImportPatterns) {
  assert.equal(pattern.test(sourceToCheck), false);
}

console.log("PASS same company scores differently across ICPs");
console.log("PASS company-only persona-sensitive ICP does not final qualify");
console.log("PASS ICP1R schema rejects old threshold and 0..1 confidence shapes");
console.log("PASS no live AI/network/Prisma/V1 imports in ICP1R files");
console.log("PASS V2 ICP scoring harness fixtures");

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
