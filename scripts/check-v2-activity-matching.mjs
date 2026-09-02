import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const {
  isGenericEmail,
  isPublicEmailDomain,
  normalizeMatchDomain,
  normalizeMatchText,
  resolveActivityMatch,
} = loadTsModule("lib/v2/activity-recaps/matchResolver.ts");
const { SAMPLE_ACTIVITY_MATCH_FIXTURES } = loadTsModule(
  "lib/v2/activity-recaps/__fixtures__/sampleActivityMatchCandidates.ts"
);

assert.equal(isGenericEmail("info@example.com"), true);
assert.equal(isGenericEmail("sales@example.com"), true);
assert.equal(isGenericEmail("ada@example.com"), false);
assert.equal(isPublicEmailDomain("john@gmail.com"), true);
assert.equal(isPublicEmailDomain("gmail.com"), true);
assert.equal(isPublicEmailDomain("acme.example"), false);
assert.equal(normalizeMatchText("  Ada   Lovelace "), "ada lovelace");
assert.equal(normalizeMatchDomain("https://www.Example.com/path?q=1"), "example.com");
console.log("PASS match normalization helpers");

for (const fixture of SAMPLE_ACTIVITY_MATCH_FIXTURES) {
  const result = resolveActivityMatch({
    activity: fixture.activity,
    candidates: fixture.candidates,
    context: fixture.context,
  });

  assert.equal(
    result.overallConfidence,
    fixture.expected.overallConfidence,
    fixture.name
  );
  assert.equal(
    result.companyMatch.confidence,
    fixture.expected.companyConfidence,
    fixture.name
  );
  assert.equal(
    result.contactMatch.confidence,
    fixture.expected.contactConfidence,
    fixture.name
  );
  assert.equal(
    result.leadAssignmentMatch.confidence,
    fixture.expected.leadAssignmentConfidence,
    fixture.name
  );
  assert.equal(
    result.managerReviewRequired,
    fixture.expected.managerReviewRequired,
    fixture.name
  );
  assert.ok(Array.isArray(result.warnings), `${fixture.name} expected warnings array`);

  for (const reasonCode of fixture.expected.reasonCodes) {
    assert.ok(
      result.reasonCodes.includes(reasonCode),
      `${fixture.name} expected reason ${reasonCode}`
    );
  }

  if (result.reasonCodes.includes("generic_email_not_contact_identity")) {
    assert.notEqual(
      result.contactMatch.confidence,
      "auto_match",
      `${fixture.name} generic email must not auto-match contact`
    );
  }

  if (result.reasonCodes.includes("phone_match_supporting_only")) {
    assert.notEqual(
      result.contactMatch.confidence,
      "auto_match",
      `${fixture.name} phone match must not auto-match contact`
    );
  }

  if (result.reasonCodes.includes("public_domain_email_blocked")) {
    assert.notEqual(
      result.companyMatch.confidence,
      "auto_match",
      `${fixture.name} public email domain must not auto-match company`
    );
    assert.ok(
      !result.reasonCodes.includes("exact_company_domain_match"),
      `${fixture.name} public email domain must not produce exact company domain match`
    );
  }

  if (result.reasonCodes.includes("contact_company_mismatch")) {
    assert.equal(
      result.overallConfidence,
      "needs_review",
      `${fixture.name} contact-company mismatch must force review`
    );
    assert.equal(
      result.managerReviewRequired,
      true,
      `${fixture.name} contact-company mismatch must require review`
    );
  }

  if (result.leadAssignmentMatch.confidence !== "no_match") {
    assert.ok(
      !result.suggestedActions.includes("create_lead_assignment"),
      `${fixture.name} must not suggest creating an already matched LeadAssignment`
    );
  }

  if (
    result.leadAssignmentMatch.confidence === "no_match" &&
    result.companyMatch.confidence !== "no_match"
  ) {
    assert.ok(
      result.suggestedActions.includes("create_lead_assignment"),
      `${fixture.name} should suggest LeadAssignment creation when company context exists`
    );
  }

  if (result.managerReviewRequired) {
    assert.ok(
      result.reasonCodes.length > 0,
      `${fixture.name} review trigger must be represented by reasonCodes`
    );
  }
}

console.log("PASS V2 activity match confidence fixtures");

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
