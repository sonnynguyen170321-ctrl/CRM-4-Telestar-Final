import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const { mapNeutralFactsToCompanyEvidence } = loadTsModule(
  "lib/v2/company-intelligence/mapIntelligenceToCompanyEvidence.ts"
);

const sharedNeutralFacts = [
  "offering.cybersecurity",
  "offering.cloud_infrastructure",
  "offering.erp",
  "industry.banking",
  "industry.manufacturing",
  "geo.hq_country_singapore",
  "geo.factory_country_vietnam",
  "company.size_large",
];

const sharedCompanyEvidence = {
  companyName: "Acme Multi ICP Infrastructure",
  website: "https://acme-multi-icp.example",
  canonicalDomain: "acme-multi-icp.example",
  employeeCount: 350,
  employeeRange: "201-500",
  ...mapNeutralFactsToCompanyEvidence(sharedNeutralFacts),
};

function summarize(assessment) {
  return {
    qualification: assessment.qualification,
    fitScore: assessment.fitScore,
    confidence: assessment.confidence,
    accountPreRank: assessment.accountPreRank,
    positiveSignals: assessment.positiveSignalsHit.map((hit) => hit.id),
    hardDisqualifiers: assessment.hardDisqualifiersHit.map((hit) => hit.id),
    reasonCodes: assessment.reasonCodes,
  };
}

function persona(title, department, seniorityTier) {
  return {
    title,
    rawTitle: title,
    department,
    seniorityTier,
    titleKeywords: title.split(/\s+/).map((part) => part.toLowerCase()),
  };
}

const BASE_WEIGHTS = {
  geography: 5,
  companyType: 15,
  industry: 20,
  size: 15,
  persona: 25,
  positiveSignals: 20,
  negativeSignals: 20,
};

const BASE_POLICIES = {
  schemaVersion: "v1",
  missingWebsitePolicy: "review_required",
  companySize: {
    minEmployees: 25,
    maxEmployees: 5000,
    unknownSizePolicy: "review_required",
  },
  confidencePolicy: {
    highConfidenceThreshold: 75,
    mediumConfidenceThreshold: 45,
  },
  scorePolicy: {
    minScore: 0,
    maxScore: 100,
    qualifiedMinFitScore: 70,
    needsReviewMinFitScore: 45,
  },
  companyTypeRules: [
    {
      id: "product_platform",
      type: "PRODUCT_PLATFORM",
      positiveKeywords: ["platform", "software", "cloud", "erp", "cybersecurity"],
      negativeKeywords: ["agency only"],
    },
    {
      id: "service_only",
      type: "SERVICE_ONLY",
      positiveKeywords: ["outsourcing only", "consulting only"],
      negativeKeywords: ["platform", "software"],
    },
  ],
  scoringWeights: BASE_WEIGHTS,
  requiredEvidenceForFinalQualification: {
    explicitGeo: false,
    employeeSize: true,
    personaTitle: true,
  },
  blocksFinalQualificationFromCompanyOnlyEvidence: true,
};

const STORMWALL_ICP_RULES = {
  ...BASE_POLICIES,
  ruleSetId: "fixture-stormwall",
  displayName: "Stormwall Cybersecurity",
  geography: {
    targetCountries: ["Singapore", "Vietnam", "Malaysia", "Indonesia", "UAE", "Saudi Arabia"],
    excludedCountries: [],
    unknownCountryPolicy: "low_confidence_continue",
  },
  hardGates: [
    {
      id: "stormwall_too_small",
      label: "Too small for Stormwall",
      field: "employeeCount",
      operator: "lt",
      value: 25,
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "company size",
      reasonCode: "target_size_too_small",
    },
  ],
  positiveSignals: [
    {
      id: "stormwall_cyber_banking",
      label: "Cybersecurity plus protected-network vertical",
      keywords: ["cybersecurity", "security", "banking", "network protection", "telecom"],
      evidenceSources: ["website_homepage", "website_subpage"],
      reasonCode: "target_industry_match",
    },
  ],
  negativeSignals: [],
};

const ONE_CLOUD_HUB_ICP_RULES = {
  ...BASE_POLICIES,
  ruleSetId: "fixture-1cloudhub",
  displayName: "1CloudHub Singapore Cloud",
  geography: {
    targetCountries: ["Singapore"],
    excludedCountries: [],
    unknownCountryPolicy: "low_confidence_continue",
  },
  hardGates: [
    {
      id: "onecloudhub_exclude_engineer",
      label: "Engineer title excluded",
      field: "personaTitle",
      operator: "contains",
      value: ["engineer"],
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "contact title",
      reasonCode: "target_persona_excluded_title",
    },
  ],
  positiveSignals: [
    {
      id: "onecloudhub_singapore_cloud",
      label: "Singapore cloud/infrastructure buyer",
      keywords: ["singapore", "cloud infrastructure", "cloud", "infrastructure", "it manager"],
      evidenceSources: ["website_homepage", "pipeline_context"],
      reasonCode: "target_company_type_match",
    },
  ],
  negativeSignals: [],
};

const STS_EPICOR_ICP_RULES = {
  ...BASE_POLICIES,
  ruleSetId: "fixture-sts-epicor",
  displayName: "STS Epicor Manufacturing ERP",
  geography: {
    targetCountries: ["Vietnam"],
    excludedCountries: [],
    unknownCountryPolicy: "low_confidence_continue",
  },
  hardGates: [
    {
      id: "sts_logistics_only",
      label: "Logistics-only company",
      field: "evidenceText",
      operator: "contains",
      value: ["warehouse only", "logistics only"],
      severity: "terminal",
      confidence: "HIGH",
      evidenceSource: "company evidence",
      reasonCode: "target_industry_mismatch",
    },
  ],
  positiveSignals: [
    {
      id: "sts_vietnam_factory_erp",
      label: "Vietnam factory manufacturing ERP",
      keywords: ["erp", "manufacturing", "factory in vietnam", "plant director"],
      evidenceSources: ["website_homepage", "website_subpage", "pipeline_context"],
      reasonCode: "target_industry_match",
    },
  ],
  negativeSignals: [],
};

validateIcpVersionRules(STORMWALL_ICP_RULES);
validateIcpVersionRules(ONE_CLOUD_HUB_ICP_RULES);
validateIcpVersionRules(STS_EPICOR_ICP_RULES);

const stormwallAssessment = assessCompanyAgainstIcp(
  sharedCompanyEvidence,
  STORMWALL_ICP_RULES,
  persona("Security Engineer", "Engineering", "IC")
);
const oneCloudHubManagerAssessment = assessCompanyAgainstIcp(
  sharedCompanyEvidence,
  ONE_CLOUD_HUB_ICP_RULES,
  persona("IT Manager", "IT", "MANAGER")
);
const oneCloudHubEngineerAssessment = assessCompanyAgainstIcp(
  sharedCompanyEvidence,
  ONE_CLOUD_HUB_ICP_RULES,
  persona("Security Engineer", "Engineering", "IC")
);
const stsAssessment = assessCompanyAgainstIcp(
  sharedCompanyEvidence,
  STS_EPICOR_ICP_RULES,
  persona("Plant Director", "Manufacturing", "DIRECTOR")
);

assert.ok(
  stormwallAssessment.positiveSignalsHit.some((hit) => hit.id === "stormwall_cyber_banking"),
  "Stormwall should interpret cybersecurity/banking facts as positive."
);
assert.ok(
  oneCloudHubManagerAssessment.positiveSignalsHit.some((hit) => hit.id === "onecloudhub_singapore_cloud"),
  "1CloudHub should interpret Singapore/cloud facts as positive."
);
assert.ok(
  stsAssessment.positiveSignalsHit.some((hit) => hit.id === "sts_vietnam_factory_erp"),
  "STS should interpret ERP/manufacturing/Vietnam factory facts as positive."
);
assert.ok(
  oneCloudHubEngineerAssessment.hardDisqualifiersHit.some((hit) => hit.id === "onecloudhub_exclude_engineer"),
  "1CloudHub engineer-title control must hit the engineer exclusion."
);
assert.equal(oneCloudHubEngineerAssessment.accountPreRank, "CLEAR_MISMATCH");
assert.ok(
  oneCloudHubManagerAssessment.fitScore > oneCloudHubEngineerAssessment.fitScore,
  "1CloudHub IT Manager should score above the engineer-title control."
);

const uniqueResultSignatures = new Set(
  [stormwallAssessment, oneCloudHubManagerAssessment, stsAssessment].map(
    (assessment) =>
      `${assessment.qualification}:${assessment.fitScore}:${assessment.accountPreRank}:${assessment.reasonCodes.join(",")}`
  )
);
assert.ok(
  uniqueResultSignatures.size > 1,
  "Same company facts must not produce identical ICP interpretations."
);

for (const assessment of [
  stormwallAssessment,
  oneCloudHubManagerAssessment,
  oneCloudHubEngineerAssessment,
  stsAssessment,
]) {
  assert.ok(!JSON.stringify(assessment.inputSnapshot).includes("qualification"));
}

console.log("PASS same neutral company intelligence produces different ICP-specific outcomes");
console.log(
  JSON.stringify(
    {
      stormwall: summarize(stormwallAssessment),
      oneCloudHubManager: summarize(oneCloudHubManagerAssessment),
      oneCloudHubEngineerControl: summarize(oneCloudHubEngineerAssessment),
      stsEpicor: summarize(stsAssessment),
    },
    null,
    2
  )
);

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
    if (specifier === "server-only") {
      return {};
    }

    if (specifier.startsWith("@/")) {
      const aliasPath = resolve(rootDir, specifier.slice(2));
      const resolvedPath = existsSync(`${aliasPath}.ts`)
        ? `${aliasPath}.ts`
        : resolve(aliasPath, "index.ts");

      return loadTsModule(resolvedPath.slice(rootDir.length + 1));
    }

    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    const modulePath = resolve(dirname(absolutePath), specifier);
    const resolvedPath = existsSync(`${modulePath}.ts`)
      ? `${modulePath}.ts`
      : resolve(modulePath, "index.ts");
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
