import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SC1 smoke: prove schema-v2 + reference dictionaries are well-formed, expressive
// enough for the hard dimensions of the 18-ICP corpus, and that the v1->v2 lift is
// lossless for what v1 actually modeled. Pure: no DB, no network, no provider calls.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const dictionaries = loadTsModule("lib/v2/scoring/rules/dictionaries/index.ts");
const {
  DICTIONARY_VERSIONS,
  REGION_KEYS,
  REGION_TO_COUNTRIES,
  expandRegionsToCountries,
  isGenericEmailDomain,
  extractEmailDomain,
  lookupSeniority,
  meetsSeniorityFloor,
  canonicalizeIndustry,
  resolveSizeBand,
  qualitativeSizeToBand,
  employeeCountInBands,
} = dictionaries;

const { validateIcpVersionRulesV2, safeValidateIcpVersionRulesV2 } = loadTsModule(
  "lib/v2/scoring/rules/schema-v2.ts"
);
const { upgradeV1toV2 } = loadTsModule("lib/v2/scoring/rules/upgradeV1toV2.ts");
const { TELESTAR_SAAS_OUTBOUND_ICP_RULES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/sampleIcpRules.ts"
);

// ---------------------------------------------------------------------------
// 1. Dictionaries are well-formed + versioned
// ---------------------------------------------------------------------------

const versionKeys = Object.keys(DICTIONARY_VERSIONS).sort();
assert.deepEqual(versionKeys, [
  "genericEmail",
  "industry",
  "regions",
  "seniority",
  "sizeBands",
]);
for (const [key, value] of Object.entries(DICTIONARY_VERSIONS)) {
  assert.ok(typeof value === "string" && value.length > 0, `dictionary version ${key} present`);
}

for (const region of REGION_KEYS) {
  const countries = REGION_TO_COUNTRIES[region];
  assert.ok(Array.isArray(countries) && countries.length > 0, `region ${region} non-empty`);
  assert.equal(new Set(countries).size, countries.length, `region ${region} has no duplicate countries`);
}

// region expansion is deterministic + sorted + deduped
assert.deepEqual(expandRegionsToCountries(["ANZ"]), ["Australia", "New Zealand"]);
assert.deepEqual(expandRegionsToCountries(["ANZ"]), expandRegionsToCountries(["ANZ"]));
assert.ok(expandRegionsToCountries(["NORTH_AMERICA"]).includes("United States"));
assert.deepEqual(expandRegionsToCountries(["NOT_A_REGION"]), []);

// generic-email disqualifier dictionary
assert.equal(isGenericEmailDomain("jane@gmail.com"), true);
assert.equal(isGenericEmailDomain("jane@telestar.io"), false);
assert.equal(isGenericEmailDomain("yahoo.co.uk"), true);
assert.equal(extractEmailDomain("Jane.Doe@Gmail.com"), "gmail.com");
assert.equal(extractEmailDomain("not-an-email"), null);

// seniority taxonomy (EN + German + IC exclusions)
assert.equal(lookupSeniority("Chief Executive Officer").tier, "C_LEVEL");
assert.equal(lookupSeniority("Software Engineer").tier, "IC");
assert.equal(lookupSeniority("Software Engineer").department, "ENGINEERING");
assert.equal(lookupSeniority("Head of Sales").tier, "HEAD");
assert.equal(lookupSeniority("HR Manager").department, "HR");
assert.equal(lookupSeniority("Direktor").tier, "DIRECTOR"); // German
assert.equal(lookupSeniority("Mitglied der Geschäftsleitung").tier, "C_LEVEL");
assert.equal(lookupSeniority("").tier, "UNKNOWN");
assert.equal(meetsSeniorityFloor("DIRECTOR", "MANAGER"), true);
assert.equal(meetsSeniorityFloor("IC", "DIRECTOR"), false);

// industry taxonomy
assert.equal(canonicalizeIndustry("SaaS"), "SAAS");
assert.equal(canonicalizeIndustry("Banking"), "BANKING");
assert.equal(canonicalizeIndustry("web3"), "CRYPTO");
assert.equal(canonicalizeIndustry("totally unknown vertical"), null);

// size bands (numeric + qualitative)
assert.equal(resolveSizeBand(5), "MICRO");
assert.equal(resolveSizeBand(120), "MEDIUM");
assert.equal(resolveSizeBand(0), null);
assert.equal(qualitativeSizeToBand("Enterprise"), "ENTERPRISE");
assert.equal(qualitativeSizeToBand("SME"), "SMALL");
assert.equal(qualitativeSizeToBand("Medium-Well"), "MID_MARKET");
assert.equal(employeeCountInBands(30, ["SMALL", "MEDIUM"]), true);
assert.equal(employeeCountInBands(5000, ["SMALL"]), false);

console.log("PASS dictionaries well-formed, versioned, deterministic");

// ---------------------------------------------------------------------------
// 2. schema-v2 accepts ICPs that exercise the 8 hard dimensions
// ---------------------------------------------------------------------------

const BASE_POLICIES = {
  scoringWeights: { geo: 20, industry: 15, companyType: 15, size: 10, persona: 30, signals: 10 },
  scorePolicy: { minScore: 0, maxScore: 100, qualifiedMinFitScore: 75, needsReviewMinFitScore: 45 },
  confidencePolicy: { highConfidenceThreshold: 75, mediumConfidenceThreshold: 45 },
  dictionaryVersions: DICTIONARY_VERSIONS,
};

function emptyPersona(overrides = {}) {
  return {
    titleAllowlist: [],
    titleDenylist: [],
    titleTiers: [],
    seniorityExclusions: [],
    departmentAllowlist: [],
    departmentSeniorityOverrides: {},
    titleKeywords: [],
    languageVariants: {},
    requirePersonaForFinalQualification: true,
    ...overrides,
  };
}

function emptyGeography(overrides = {}) {
  return {
    targetCountries: [],
    excludedCountries: [],
    targetRegions: [],
    locationScope: "hq",
    requiredOfficeCountries: [],
    excludedOfficeCountries: [],
    priorityTiers: [],
    subNationalRegions: [],
    unknownCountryPolicy: "review_required",
    ...overrides,
  };
}

// (a) TeleStar: office-location exclusion + generic-email + services-except-VN exception
const TELESTAR_V2 = {
  schemaVersion: "v2",
  ruleSetId: "icp2-telestar-saas-outbound",
  displayName: "TeleStar SaaS Outbound (v2)",
  geography: emptyGeography({
    targetCountries: ["United States", "Australia", "Singapore", "Israel"],
    excludedCountries: ["India", "Pakistan", "Bangladesh", "Philippines"],
    locationScope: "any_office",
    excludedOfficeCountries: ["India", "Pakistan", "Bangladesh", "Philippines"],
  }),
  industry: { mode: "all", targetIndustries: [], excludedIndustries: [], industryKeywords: ["saas", "software"], subIndustries: [] },
  companyType: {
    allow: ["PRODUCT_SAAS", "PRODUCT_PLATFORM"],
    deny: ["AGENCY"],
    servicesConsultingPolicy: { disqualify: true, exceptMarkets: ["Vietnam"] },
  },
  persona: emptyPersona({
    titleAllowlist: ["Founder", "CEO", "COO", "CRO", "VP Sales", "Head of Sales", "Head of Growth"],
    seniorityFloor: "DIRECTOR",
  }),
  size: { minEmployees: 3, sizeBands: [], excludeTooSmall: true, unknownSizePolicy: "review_required" },
  disqualifiers: {
    genericEmailContact: { disqualify: true },
    onePersonCompany: { disqualify: true, threshold: 3 },
    websiteOffline: { disqualify: true },
    projectBased: { disqualify: false },
    competitorDenylist: [],
  },
  accountSupplied: { mode: "score", companyList: [] },
  requiredEvidenceForFinalQualification: { explicitGeo: true, employeeSize: true, personaTitle: true, websiteReachable: true },
  ...BASE_POLICIES,
  blocksFinalQualificationFromCompanyOnlyEvidence: true,
};

// (b) Alison: region geo + excludeCountry + persona tiers + denylist + competitor denylist
const ALISON_V2 = {
  schemaVersion: "v2",
  ruleSetId: "icp2-alison-courses",
  displayName: "Alison Online Courses (v2)",
  geography: emptyGeography({ targetRegions: ["NORTH_AMERICA"], excludedCountries: ["India"] }),
  industry: { mode: "all", targetIndustries: [], excludedIndustries: [], industryKeywords: [], subIndustries: [] },
  companyType: { allow: [], deny: [], servicesConsultingPolicy: { disqualify: false, exceptMarkets: [] } },
  persona: emptyPersona({
    titleTiers: [
      { tier: 1, titles: ["CMO", "CEO", "Founder"], keywords: ["marketing", "creative"], weight: 100 },
      { tier: 2, titles: [], keywords: ["growth", "user acquisition", "performance", "advertising", "analytics"], weight: 60 },
    ],
    titleDenylist: ["Associate", "Assistant", "Product Marketing", "Email Marketing", "Manager"],
    requirePersonaForFinalQualification: true,
  }),
  size: { sizeBands: [], unknownSizePolicy: "low_confidence_continue" },
  disqualifiers: {
    genericEmailContact: { disqualify: false },
    onePersonCompany: { disqualify: false },
    websiteOffline: { disqualify: false },
    projectBased: { disqualify: false },
    competitorDenylist: ["Google", "Meta", "TikTok"],
  },
  accountSupplied: { mode: "score", companyList: [] },
  requiredEvidenceForFinalQualification: { explicitGeo: true, employeeSize: false, personaTitle: true, websiteReachable: false },
  ...BASE_POLICIES,
  blocksFinalQualificationFromCompanyOnlyEvidence: true,
};

// (c) FlexEnergy: account-supplied skip + German language variants + sub-national region
const FLEXENERGY_V2 = {
  schemaVersion: "v2",
  ruleSetId: "icp2-flexenergy-utility",
  displayName: "FlexEnergy Utility (v2)",
  geography: emptyGeography({
    targetCountries: ["Switzerland"],
    subNationalRegions: ["German-speaking Switzerland"],
    targetRegions: ["GERMAN_SPEAKING"],
  }),
  industry: { mode: "allowlist", targetIndustries: ["UTILITY"], excludedIndustries: [], industryKeywords: ["electricity distribution"], subIndustries: ["electricity distribution"] },
  companyType: { allow: [], deny: [], servicesConsultingPolicy: { disqualify: false, exceptMarkets: [] } },
  persona: emptyPersona({
    titleAllowlist: ["Direktor", "Mitglied der Geschäftsleitung", "Digital Manager", "Innovation Manager"],
    languageVariants: { de: ["Direktor", "Leiter Inkasso", "Produktmanager"] },
  }),
  size: { sizeBands: ["MEDIUM", "MID_MARKET"], unknownSizePolicy: "review_required" },
  disqualifiers: {
    genericEmailContact: { disqualify: false },
    onePersonCompany: { disqualify: false },
    websiteOffline: { disqualify: false },
    projectBased: { disqualify: false },
    competitorDenylist: [],
  },
  accountSupplied: { mode: "preapproved_skip", companyList: ["ewz.ch", "bkw.ch"] },
  requiredEvidenceForFinalQualification: { explicitGeo: true, employeeSize: false, personaTitle: true, websiteReachable: false },
  ...BASE_POLICIES,
  blocksFinalQualificationFromCompanyOnlyEvidence: true,
};

// (d) Chainwire: two sub-ICPs (crypto vs cyber) with overrides + region expansion
const CHAINWIRE_V2 = {
  schemaVersion: "v2",
  ruleSetId: "icp2-chainwire",
  displayName: "Chainwire (v2)",
  geography: emptyGeography({ targetCountries: ["United States"] }),
  industry: { mode: "all", targetIndustries: [], excludedIndustries: [], industryKeywords: [], subIndustries: [] },
  companyType: { allow: [], deny: [], servicesConsultingPolicy: { disqualify: false, exceptMarkets: [] } },
  persona: emptyPersona({ requirePersonaForFinalQualification: true }),
  size: { sizeBands: [], unknownSizePolicy: "low_confidence_continue" },
  disqualifiers: {
    genericEmailContact: { disqualify: false },
    onePersonCompany: { disqualify: false },
    websiteOffline: { disqualify: false },
    projectBased: { disqualify: false },
    competitorDenylist: [],
  },
  accountSupplied: { mode: "score", companyList: [] },
  subIcps: [
    {
      id: "crypto",
      label: "Crypto market",
      keywords: ["crypto", "defi", "nft", "web3"],
      geography: { targetCountries: ["United States"] },
      industry: { mode: "denylist", excludedIndustries: ["MARKETING", "MEDIA", "INSURANCE", "EDUCATION"] },
    },
    {
      id: "cyber",
      label: "Cyber market",
      keywords: ["cyber", "security", "devops", "ddos"],
      geography: { targetRegions: ["APAC", "SOUTH_AMERICA"] },
      size: { sizeBands: ["MEDIUM", "MID_MARKET", "ENTERPRISE"], unknownSizePolicy: "review_required" },
    },
  ],
  requiredEvidenceForFinalQualification: { explicitGeo: true, employeeSize: false, personaTitle: true, websiteReachable: false },
  ...BASE_POLICIES,
  blocksFinalQualificationFromCompanyOnlyEvidence: false,
};

for (const rules of [TELESTAR_V2, ALISON_V2, FLEXENERGY_V2, CHAINWIRE_V2]) {
  const parsed = validateIcpVersionRulesV2(rules);
  assert.equal(parsed.schemaVersion, "v2");
  assert.equal(parsed.ruleSetId, rules.ruleSetId);
}
assert.equal(validateIcpVersionRulesV2(CHAINWIRE_V2).subIcps.length, 2);
assert.equal(
  validateIcpVersionRulesV2(TELESTAR_V2).companyType.servicesConsultingPolicy.exceptMarkets[0],
  "Vietnam"
);

console.log("PASS schema-v2 accepts 8-dimension corpus ICPs (TeleStar/Alison/FlexEnergy/Chainwire)");

// ---------------------------------------------------------------------------
// 3. schema-v2 rejects malformed rules
// ---------------------------------------------------------------------------

assert.throws(
  () => validateIcpVersionRulesV2({ ...TELESTAR_V2, scoringWeights: { ...TELESTAR_V2.scoringWeights, persona: 99 } }),
  "weights must sum to 100"
);
assert.throws(
  () => validateIcpVersionRulesV2({ ...TELESTAR_V2, schemaVersion: "v1" }),
  "schemaVersion must be literal v2"
);
assert.throws(
  () => validateIcpVersionRulesV2({ ...TELESTAR_V2, ruleSetId: "uncertain" }),
  "canonical UNCERTAIN is rejected"
);
assert.throws(
  () => validateIcpVersionRulesV2({ ...TELESTAR_V2, geography: emptyGeography({ targetRegions: ["NOT_A_REGION"] }) }),
  "unknown region key is rejected"
);
assert.throws(
  () => validateIcpVersionRulesV2({ ...TELESTAR_V2, unexpectedField: true }),
  "strict object rejects unknown fields"
);
assert.equal(safeValidateIcpVersionRulesV2({ ...TELESTAR_V2, schemaVersion: "v3" }).success, false);

console.log("PASS schema-v2 rejects bad weights/version/uncertain/region/extra-field");

// ---------------------------------------------------------------------------
// 4. v1 -> v2 lift is structurally valid and lossless for v1's dimensions
// ---------------------------------------------------------------------------

const lifted = upgradeV1toV2(TELESTAR_SAAS_OUTBOUND_ICP_RULES);
const liftedParsed = validateIcpVersionRulesV2(lifted);

assert.equal(liftedParsed.ruleSetId, "icp1r-telestar-saas-outbound");
assert.ok(liftedParsed.geography.targetCountries.includes("Singapore"));
assert.ok(liftedParsed.geography.excludedCountries.includes("India"));
assert.equal(liftedParsed.persona.requirePersonaForFinalQualification, true);
assert.equal(liftedParsed.disqualifiers.onePersonCompany.disqualify, true);
assert.equal(liftedParsed.disqualifiers.websiteOffline.disqualify, false); // v1 missingWebsitePolicy=review_required
assert.equal(liftedParsed.companyType.servicesConsultingPolicy.disqualify, true);
assert.deepEqual(liftedParsed.dictionaryVersions, DICTIONARY_VERSIONS);

const weightTotal =
  liftedParsed.scoringWeights.geo +
  liftedParsed.scoringWeights.industry +
  liftedParsed.scoringWeights.companyType +
  liftedParsed.scoringWeights.size +
  liftedParsed.scoringWeights.persona +
  liftedParsed.scoringWeights.signals;
assert.equal(weightTotal, 100);

// lift is a pure deterministic function
assert.deepEqual(upgradeV1toV2(TELESTAR_SAAS_OUTBOUND_ICP_RULES), lifted);

console.log("PASS v1->v2 lift is valid, lossless for v1 dimensions, and deterministic");

// ---------------------------------------------------------------------------
// 5. No live AI / network / Prisma / V1 business imports in the rules module
// ---------------------------------------------------------------------------

const ruleSourceFiles = [
  "lib/v2/scoring/rules/schema-v2.ts",
  "lib/v2/scoring/rules/upgradeV1toV2.ts",
  "lib/v2/scoring/rules/index.ts",
  "lib/v2/scoring/rules/dictionaries/index.ts",
  "lib/v2/scoring/rules/dictionaries/regions.ts",
  "lib/v2/scoring/rules/dictionaries/genericEmail.ts",
  "lib/v2/scoring/rules/dictionaries/seniority.ts",
  "lib/v2/scoring/rules/dictionaries/industry.ts",
  "lib/v2/scoring/rules/dictionaries/sizeBands.ts",
  "scripts/check-v2-icp-schema-v2.mjs",
];
const ruleSource = ruleSourceFiles
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
    ruleSource.toLowerCase().includes(fragment.toLowerCase()),
    false,
    `forbidden fragment ${fragment} should not appear in rules module`
  );
}

console.log("PASS no live AI/network/Prisma in SC1 rules module");
console.log("PASS V2 ICP schema-v2 + dictionaries SC1 smoke");

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
