import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { normalizeScoringInput } = loadTsModule("lib/v2/scoring/normalizeInput.ts");
const { assessDataQuality } = loadTsModule("lib/v2/scoring/dataQuality.ts");
const { evaluateHardGates } = loadTsModule(
  "lib/v2/scoring/evaluateHardGates.ts"
);
const { collectEvidence } = loadTsModule("lib/v2/scoring/collectEvidence.ts");
const { classifyCompanyType } = loadTsModule(
  "lib/v2/scoring/classifyCompanyType.ts"
);
const { computeFitScore } = loadTsModule("lib/v2/scoring/computeFitScore.ts");
const { computeConfidence } = loadTsModule("lib/v2/scoring/computeConfidence.ts");
const { deriveQualification } = loadTsModule(
  "lib/v2/scoring/deriveQualification.ts"
);
const { explainAssessment } = loadTsModule("lib/v2/scoring/explainAssessment.ts");
const {
  DATA_POOR_COMPANY_INPUT_FIXTURE,
  EXCLUDED_COUNTRY_COMPANY_INPUT_FIXTURE,
  MISSING_WEBSITE_COMPANY_INPUT_FIXTURE,
  PERFECT_FIT_COMPANY_INPUT_FIXTURE,
  SERVICE_PLUS_PRODUCT_COMPANY_INPUT_FIXTURE,
  SERVICE_ONLY_COMPANY_INPUT_FIXTURE,
} = loadTsModule("lib/v2/scoring/__fixtures__/sampleScoringInputs.ts");

const perfectFitContext = normalizeScoringInput(
  PERFECT_FIT_COMPANY_INPUT_FIXTURE
);
const perfectFitQuality = assessDataQuality(perfectFitContext);
assert.equal(perfectFitContext.company.canonicalDomain, "brightwave.example");
assert.equal(perfectFitQuality.qualityLevel, "high");
assert.equal(perfectFitQuality.reviewRequired, false);
console.log("PASS perfect fit normalizes with high data quality");

const parkedWebsiteContext = normalizeScoringInput({
  ...PERFECT_FIT_COMPANY_INPUT_FIXTURE,
  websiteEvidence: {
    ...PERFECT_FIT_COMPANY_INPUT_FIXTURE.websiteEvidence,
    status: "parked",
  },
});
const parkedWebsiteQuality = assessDataQuality(parkedWebsiteContext);
assert.ok(
  parkedWebsiteQuality.issues.some(
    (issue) =>
      issue.code === "website_not_reachable" &&
      issue.severity === "confidence_penalty"
  )
);
console.log("PASS parked website evidence creates a data quality issue");

const missingWebsiteContext = normalizeScoringInput(
  MISSING_WEBSITE_COMPANY_INPUT_FIXTURE
);
const missingWebsiteGates = evaluateHardGates(missingWebsiteContext);
assert.equal(missingWebsiteContext.company.canonicalDomain, null);
assert.equal(
  missingWebsiteGates.policyResults[0].policyAction,
  "review_required"
);
assert.equal(missingWebsiteGates.summary.terminalCount, 0);
console.log("PASS missing website applies review policy without terminal result");

const excludedCountryContext = normalizeScoringInput(
  EXCLUDED_COUNTRY_COMPANY_INPUT_FIXTURE
);
const excludedCountryGates = evaluateHardGates(excludedCountryContext);
assert.ok(
  excludedCountryGates.summary.triggeredRuleIds.includes("excluded_country")
);
assert.equal(
  excludedCountryGates.results.find((result) => result.ruleId === "excluded_country")
    ?.policyAction,
  "strong_penalty"
);
console.log("PASS excluded country triggers configured hard gate");

const serviceOnlyContext = normalizeScoringInput(SERVICE_ONLY_COMPANY_INPUT_FIXTURE);
const serviceOnlyGates = evaluateHardGates(serviceOnlyContext);
assert.equal(serviceOnlyContext.websiteEvidence.serviceSignals.length, 2);
assert.equal(serviceOnlyGates.summary.triggeredRuleIds.includes("service_only"), false);
console.log("PASS service-only evidence is not a hard gate without explicit rule");

const dataPoorContext = normalizeScoringInput(DATA_POOR_COMPANY_INPUT_FIXTURE);
const dataPoorQuality = assessDataQuality(dataPoorContext);
assert.equal(dataPoorQuality.qualityLevel, "low");
assert.equal(dataPoorQuality.reviewRequired, true);
console.log("PASS data-poor fixture creates review pressure only");

const perfectFitGates = evaluateHardGates(perfectFitContext);
const perfectFitEvidence = collectEvidence(perfectFitContext, perfectFitGates);
const perfectFitType = classifyCompanyType(perfectFitContext, perfectFitEvidence);
const perfectFitScore = computeFitScore(
  perfectFitContext,
  perfectFitEvidence,
  perfectFitGates,
  perfectFitType
);
assert.ok(perfectFitEvidence.positiveItems.length > 0);
assert.equal(perfectFitEvidence.negativeItems.length, 0);
assert.ok(perfectFitScore.fitScore > 50);
assert.equal("qualification" in perfectFitScore, false);
assert.equal("confidence" in perfectFitScore, false);
assert.equal("reason" in perfectFitScore, false);
console.log("PASS perfect fit collects positive evidence and scores higher");

const serviceOnlyEvidence = collectEvidence(serviceOnlyContext, serviceOnlyGates);
const serviceOnlyType = classifyCompanyType(serviceOnlyContext, serviceOnlyEvidence);
const serviceOnlyScore = computeFitScore(
  serviceOnlyContext,
  serviceOnlyEvidence,
  serviceOnlyGates,
  serviceOnlyType
);
assert.equal(serviceOnlyType.selectedType, "service_only");
assert.ok(serviceOnlyScore.fitScore < perfectFitScore.fitScore);
console.log("PASS service-only classifies and scores lower than perfect fit");

const servicePlusContext = normalizeScoringInput(
  SERVICE_PLUS_PRODUCT_COMPANY_INPUT_FIXTURE
);
const servicePlusGates = evaluateHardGates(servicePlusContext);
const servicePlusEvidence = collectEvidence(servicePlusContext, servicePlusGates);
const servicePlusType = classifyCompanyType(servicePlusContext, servicePlusEvidence);
const servicePlusScore = computeFitScore(
  servicePlusContext,
  servicePlusEvidence,
  servicePlusGates,
  servicePlusType
);
assert.notEqual(servicePlusType.selectedType, "service_only");
assert.ok(servicePlusScore.fitScore > serviceOnlyScore.fitScore);
console.log("PASS service-plus-product remains distinct from service-only");

const excludedCountryEvidence = collectEvidence(
  excludedCountryContext,
  excludedCountryGates
);
const excludedCountryType = classifyCompanyType(
  excludedCountryContext,
  excludedCountryEvidence
);
const excludedCountryScore = computeFitScore(
  excludedCountryContext,
  excludedCountryEvidence,
  excludedCountryGates,
  excludedCountryType
);
assert.ok(excludedCountryScore.fitScore <= 35);
assert.ok(
  excludedCountryScore.components.some(
    (component) => component.kind === "hard_gate_penalty"
  ) || excludedCountryScore.appliedCaps.length > 0
);
assert.equal("qualification" in excludedCountryScore, false);
console.log("PASS excluded-country hard gate affects score without qualification");

const perfectFitConfidence = computeConfidence(
  perfectFitContext,
  perfectFitQuality,
  perfectFitEvidence,
  perfectFitGates,
  perfectFitType,
  perfectFitScore
);
const perfectFitQualification = deriveQualification(
  perfectFitContext,
  perfectFitScore,
  perfectFitConfidence,
  perfectFitGates
);
assert.equal(perfectFitConfidence.confidenceLevel, "high");
assert.equal(perfectFitQualification.qualification, "qualified");
assert.ok(perfectFitQualification.reasonCodes.includes("fit_score_qualified"));
assert.equal(
  perfectFitQualification.reasonCodes.includes("missing_website_review"),
  false
);
assert.equal(
  perfectFitQualification.reasonCodes.includes(
    "website_evidence_review_downgrade"
  ),
  false
);
console.log("PASS perfect fit returns high confidence and qualified");

const dataPoorGates = evaluateHardGates(dataPoorContext);
const dataPoorEvidence = collectEvidence(dataPoorContext, dataPoorGates);
const dataPoorType = classifyCompanyType(dataPoorContext, dataPoorEvidence);
const dataPoorScore = computeFitScore(
  dataPoorContext,
  dataPoorEvidence,
  dataPoorGates,
  dataPoorType
);
const dataPoorConfidence = computeConfidence(
  dataPoorContext,
  dataPoorQuality,
  dataPoorEvidence,
  dataPoorGates,
  dataPoorType,
  dataPoorScore
);
const dataPoorQualification = deriveQualification(
  dataPoorContext,
  dataPoorScore,
  dataPoorConfidence,
  dataPoorGates
);
assert.equal(dataPoorConfidence.confidenceLevel, "low");
assert.equal(dataPoorQualification.qualification, "uncertain");
console.log("PASS data-poor fixture returns low confidence and uncertain");

const missingWebsiteQuality = assessDataQuality(missingWebsiteContext);
const missingWebsiteEvidence = collectEvidence(missingWebsiteContext, missingWebsiteGates);
const missingWebsiteType = classifyCompanyType(
  missingWebsiteContext,
  missingWebsiteEvidence
);
const missingWebsiteScore = computeFitScore(
  missingWebsiteContext,
  missingWebsiteEvidence,
  missingWebsiteGates,
  missingWebsiteType
);
const missingWebsiteConfidence = computeConfidence(
  missingWebsiteContext,
  missingWebsiteQuality,
  missingWebsiteEvidence,
  missingWebsiteGates,
  missingWebsiteType,
  missingWebsiteScore
);
const missingWebsiteQualification = deriveQualification(
  missingWebsiteContext,
  missingWebsiteScore,
  missingWebsiteConfidence,
  missingWebsiteGates
);
assert.equal(missingWebsiteQualification.qualification, "uncertain");
assert.ok(
  missingWebsiteQualification.reasonCodes.includes("missing_website_review") ||
    missingWebsiteQualification.reasonCodes.includes("low_confidence_downgrade")
);
console.log("PASS missing website remains review/uncertain");

const excludedCountryConfidence = computeConfidence(
  excludedCountryContext,
  assessDataQuality(excludedCountryContext),
  excludedCountryEvidence,
  excludedCountryGates,
  excludedCountryType,
  excludedCountryScore
);
const excludedCountryQualification = deriveQualification(
  excludedCountryContext,
  excludedCountryScore,
  excludedCountryConfidence,
  excludedCountryGates
);
assert.notEqual(excludedCountryQualification.qualification, "qualified");
console.log("PASS excluded-country hard gate prevents qualified outcome");

const missingWebsiteQualifiedScore = {
  ...missingWebsiteScore,
  fitScore: missingWebsiteContext.icpRules.scorePolicy.qualifiedThreshold + 5,
};
const missingWebsiteHighFitQualification = deriveQualification(
  missingWebsiteContext,
  missingWebsiteQualifiedScore,
  missingWebsiteConfidence,
  missingWebsiteGates
);
assert.equal(missingWebsiteHighFitQualification.qualification, "uncertain");
assert.ok(
  missingWebsiteHighFitQualification.reasonCodes.includes(
    "website_evidence_review_downgrade"
  ) ||
    missingWebsiteHighFitQualification.reasonCodes.includes(
      "missing_website_review"
    )
);
console.log("PASS high fit score with missing website downgrades to uncertain");

const perfectFitExplanation = explainAssessment(
  perfectFitContext,
  perfectFitQuality,
  perfectFitEvidence,
  perfectFitGates,
  perfectFitType,
  perfectFitScore,
  perfectFitConfidence,
  perfectFitQualification
);
assert.ok(perfectFitExplanation.summary.length > 0);
assert.ok(perfectFitExplanation.summary.length < 160);
assert.equal("companyBrief" in perfectFitExplanation, false);
assert.equal("aiSummary" in perfectFitExplanation, false);
console.log("PASS explanation is deterministic and not an AI/company brief");

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
