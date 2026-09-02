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

const fixtures = [
  {
    name: "No research + no strong CSV signal",
    row: {
      "Company Name": "Generic Data Company",
      Website: "genericdata.example",
      "Company Country": "Australia",
    },
    check(result) {
      assert.equal(result.qualification, "uncertain");
      assert.ok(result.company_score >= 35 && result.company_score <= 45);
      assert.ok(result.confidence >= 0.25 && result.confidence <= 0.4);
      assert.match(result.reason, /website research signals are not available/i);
      assert.notEqual(result.company_score, 60);
    },
  },
  {
    name: "Not Relevant should not score 60",
    row: {
      "Company Name": "DD2 Media",
      Website: "dd2media.com",
      "Company Country": "Singapore",
      "Company Industry": "Media agency",
    },
    check(result) {
      assert.equal(result.type, "Not Relevant");
      assert.ok(result.company_score <= 35);
    },
  },
  {
    name: "Non-ICP country soft negative",
    row: {
      "Company Name": "DataSing NZ",
      Website: "datasing.nz",
      "Company Country": "New Zealand",
    },
    check(result) {
      const icpResult = scoreCompanyRow(
        {
          "Company Name": "DataSing AU",
          Website: "datasing.example",
          "Company Country": "Australia",
        },
        99
      );

      assert.ok(result.company_score < icpResult.company_score);
      assert.match(result.reason, /outside the current ICP geography/i);
    },
  },
  {
    name: "Strong SaaS CSV signal",
    row: {
      "Company Name": "Example SaaS Platform",
      Website: "examplesaas.com",
      "Company Country": "Singapore",
      "Company Industry": "SaaS",
    },
    check(result) {
      assert.equal(result.type, "SAAS");
      assert.ok(result.company_score >= 50 && result.company_score <= 70);
      assert.equal(result.qualification, "uncertain");
      assert.match(result.reason, /CSV fields suggest SAAS/i);
      assert.match(result.reason, /Website research is not available/i);
    },
  },
  {
    name: "Website research product signal",
    row: {
      "Company Name": "Product Co",
      Website: "product.example",
      "Company Country": "Singapore",
    },
    options: {
      websiteResearch: buildWebsiteResearch({
        quality: "strong",
        signals: {
          productSignals: evidence("software platform", "product"),
          pricingSignals: evidence("pricing", "pricing"),
          apiSignals: evidence("API", "api"),
        },
        classificationHints: {
          likelyProductLed: true,
          likelySaas: true,
        },
      }),
    },
    check(result) {
      assert.equal(result.type, "SAAS");
      assert.ok(result.company_score > 60);
      assert.match(result.reason, /Website shows strong product signals/i);
    },
  },
  {
    name: "Website research service signal",
    row: {
      "Company Name": "Service Co",
      Website: "service.example",
      "Company Country": "Singapore",
    },
    options: {
      websiteResearch: buildWebsiteResearch({
        signals: {
          serviceSignals: evidence("consulting", "service"),
        },
        classificationHints: {
          likelyServiceLed: true,
          likelyNotRelevant: true,
        },
      }),
    },
    check(result) {
      assert.ok(result.company_score <= 35);
      assert.ok(["Not Relevant", "ITO", "AI Service"].includes(result.type));
      assert.match(result.reason, /service-led/i);
    },
  },
];

for (const [index, fixture] of fixtures.entries()) {
  const result = scoreCompanyRow(fixture.row, index, fixture.options);
  fixture.check(result);

  if (result.type === "Not Relevant") {
    assert.ok(
      result.company_score <= 35,
      `${fixture.name}: Not Relevant scored ${result.company_score}`
    );
  }

  console.log(`PASS ${fixture.name}`);
}

function buildWebsiteResearch({
  status = "reachable",
  quality = "medium",
  signals = {},
  classificationHints = {},
} = {}) {
  const mergedSignals = {
    positiveKeywords: [],
    negativeKeywords: [],
    productSignals: [],
    serviceSignals: [],
    pricingSignals: [],
    apiSignals: [],
    aiSignals: [],
    cloudSignals: [],
    dataSignals: [],
    securitySignals: [],
    parkedSignals: [],
    hasProductSignal: false,
    hasServiceSignal: false,
    hasPricingSignal: false,
    hasApiSignal: false,
    hasAiSignal: false,
    hasCloudSignal: false,
    hasDataSignal: false,
    hasSecuritySignal: false,
    ...signals,
  };

  mergedSignals.hasProductSignal = mergedSignals.productSignals.length > 0;
  mergedSignals.hasServiceSignal = mergedSignals.serviceSignals.length > 0;
  mergedSignals.hasPricingSignal = mergedSignals.pricingSignals.length > 0;
  mergedSignals.hasApiSignal = mergedSignals.apiSignals.length > 0;
  mergedSignals.hasAiSignal = mergedSignals.aiSignals.length > 0;
  mergedSignals.hasCloudSignal = mergedSignals.cloudSignals.length > 0;
  mergedSignals.hasDataSignal = mergedSignals.dataSignals.length > 0;
  mergedSignals.hasSecuritySignal = mergedSignals.securitySignals.length > 0;

  return {
    inputUrl: "https://fixture.example",
    normalizedUrl: "https://fixture.example/",
    normalizedDomain: "fixture.example",
    finalUrl: "https://fixture.example/",
    reachable: status === "reachable",
    status,
    httpStatus: 200,
    redirectChain: [],
    pagesChecked: [],
    signals: mergedSignals,
    quality,
    classificationHints: {
      likelyProductLed: false,
      likelyServiceLed: false,
      likelySaas: false,
      likelyCloud: false,
      likelyAi: false,
      likelyDataSolution: false,
      likelyCyberSecurity: false,
      likelyNotRelevant: false,
      ...classificationHints,
    },
    summary: "Fixture website research summary.",
    errors: [],
    researchedAt: new Date(0).toISOString(),
  };
}

function evidence(keyword, category) {
  return [
    {
      keyword,
      category,
      url: "https://fixture.example/",
      snippet: `Fixture evidence for ${keyword}.`,
    },
  ];
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

    throw new Error(`Unsupported script import: ${specifier}`);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}
