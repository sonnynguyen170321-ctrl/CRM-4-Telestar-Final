import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { scoreCompanyRow } = loadTsModule("lib/scoring/scoreCompany.ts");
const {
  assessDataQuality,
  classifyCompanyType,
  collectEvidence,
  computeConfidence,
  computeFitScore,
  deriveQualification,
  evaluateHardGates,
  explainAssessment,
  normalizeScoringInput,
} = loadTsModule("lib/v2/scoring/index.ts");
const { V2_PARITY_BENCHMARK_FIXTURES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/parityBenchmarkInputs.ts"
);

const results = V2_PARITY_BENCHMARK_FIXTURES.map((fixture, index) => {
  const v1 = scoreCompanyRow(fixture.v1Row, index, fixture.v1Options || {});
  const v2 = runV2Pipeline(fixture.v2Input);

  return {
    fixture,
    v1: normalizeV1Output(v1),
    v2,
    invariantFailures: [],
    unapprovedDivergences: [],
    approvedDivergences: [],
  };
});

for (const result of results) {
  result.invariantFailures = evaluateInvariants(result, results);
  result.unapprovedDivergences = findUnapprovedDivergences(result);
  result.approvedDivergences = findApprovedDivergences(result);
}

printSummary(results);

const failures = results.filter((result) => resultStatus(result) === "fail");

assert.equal(
  failures.length,
  0,
  `V2 parity benchmark failed for ${failures
    .map((result) => result.fixture.id)
    .join(", ")}`
);

function runV2Pipeline(input) {
  const context = normalizeScoringInput(input);
  const dataQuality = assessDataQuality(context);
  const hardGates = evaluateHardGates(context);
  const evidence = collectEvidence(context, hardGates);
  const companyType = classifyCompanyType(context, evidence);
  const fitScore = computeFitScore(context, evidence, hardGates, companyType);
  const confidence = computeConfidence(
    context,
    dataQuality,
    evidence,
    hardGates,
    companyType,
    fitScore
  );
  const qualification = deriveQualification(
    context,
    fitScore,
    confidence,
    hardGates
  );
  const explanation = explainAssessment(
    context,
    dataQuality,
    evidence,
    hardGates,
    companyType,
    fitScore,
    confidence,
    qualification
  );

  return {
    score: fitScore.fitScore,
    type: companyType.selectedType,
    qualification: qualification.qualification,
    confidence: confidence.confidence,
    explanation,
  };
}

function normalizeV1Output(v1) {
  return {
    score: v1.company_score,
    type: v1.type,
    qualification: v1.qualification,
    confidence: v1.confidence,
  };
}

function evaluateInvariants(result, allResults) {
  return result.fixture.invariants.flatMap((invariant) => {
    const passed = evaluateInvariant(invariant, result, allResults);

    return passed ? [] : [invariant];
  });
}

function evaluateInvariant(invariant, result, allResults) {
  switch (invariant) {
    case "not_relevant_not_score_60":
      return !(
        result.v1.type === "Not Relevant" &&
        result.v1.score === 60
      ) && !(
        result.v2.type === "unknown" &&
        result.v2.score === 60
      );
    case "weak_or_no_website_not_high_confidence_qualified":
      return !(
        result.v2.qualification === "qualified" &&
        result.v2.confidence >= 0.7
      );
    case "product_led_above_service_only": {
      const serviceOnly = allResults.find(
        (candidate) => candidate.fixture.id === "service_only"
      );

      return serviceOnly ? result.v2.score > serviceOnly.v2.score : true;
    }
    case "missing_website_review_not_terminal":
      return result.v2.qualification === "uncertain";
    case "service_plus_product_not_auto_failed_by_service_keywords":
      return result.v2.type !== "service_only" || result.v2.qualification !== "unqualified";
    case "excluded_country_not_qualified":
      return result.v2.qualification !== "qualified";
    case "no_ai_dependency":
      return !JSON.stringify(result.v2).toLowerCase().includes("ai_insight");
  }
}

function findUnapprovedDivergences(result) {
  return comparedFields().filter((field) => {
    if (!fieldDiffers(result, field)) {
      return false;
    }

    return !result.fixture.approvedDivergences.some(
      (divergence) => divergence.field === field
    );
  });
}

function findApprovedDivergences(result) {
  return result.fixture.approvedDivergences
    .filter((divergence) => fieldDiffers(result, divergence.field))
    .map((divergence) => `${divergence.field}: ${divergence.reason}`);
}

function fieldDiffers(result, field) {
  return result.v1[field] !== result.v2[field];
}

function comparedFields() {
  return ["score", "type", "qualification", "confidence"];
}

function resultStatus(result) {
  if (
    result.invariantFailures.length > 0 ||
    result.unapprovedDivergences.length > 0
  ) {
    return "fail";
  }

  return result.approvedDivergences.length > 0 ? "approved_divergence" : "pass";
}

function printSummary(resultsToPrint) {
  console.log(
    "fixture | category | V1 score/type/qualification/confidence | V2 score/type/qualification/confidence | status | reason"
  );

  for (const result of resultsToPrint) {
    const status = resultStatus(result);
    const reason =
      status === "fail"
        ? [
            ...result.invariantFailures.map(
              (invariant) => `invariant:${invariant}`
            ),
            ...result.unapprovedDivergences.map(
              (field) => `unapproved:${field}`
            ),
          ].join("; ")
        : status === "approved_divergence"
          ? result.approvedDivergences.join("; ")
          : "all compared fields aligned";

    console.log(
      [
        `${result.fixture.id} (${result.fixture.name})`,
        result.fixture.category,
        formatOutput(result.v1),
        formatOutput(result.v2),
        status,
        reason,
      ].join(" | ")
    );
  }
}

function formatOutput(output) {
  return `${output.score}/${output.type}/${output.qualification}/${output.confidence}`;
}

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
    if (specifier === "./hardRules") {
      return loadTsModule("lib/scoring/hardRules.ts");
    }

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
