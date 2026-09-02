// M3 feedback capture smoke — pure, no network, no real DB.
// Proves: fingerprint dedup policy, UNCERTAIN rejected (Invariant 7), predicted
// snapshot from the immutable assessment, final = human truth, duplicate is a
// no-op, lead-not-found tenant guard, and that capture never mutates assessment.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { buildFeedbackFingerprint } = loadTsModule("lib/v2/feedback/fingerprint.ts");
const { isFeedbackFinalQualification, FEEDBACK_FINAL_QUALIFICATIONS } = loadTsModule(
  "lib/v2/feedback/types.ts"
);
const { createFeedbackExample } = loadTsModule(
  "lib/v2/feedback/createFeedbackExample.ts"
);

// ---------------------------------------------------------------------------
// 1. Fingerprint dedup policy
// ---------------------------------------------------------------------------

const baseFp = {
  organizationId: "org_1",
  leadAssignmentId: "la_1",
  icpVersionId: "icp_1",
  hardRuleAssessmentId: "asmt_1",
  reviewedByUserId: "user_1",
  finalQualification: "QUALIFIED",
  finalFitScore: 80,
  finalReason: "Strong fit",
  source: "manual_review",
};

assert.equal(
  buildFeedbackFingerprint(baseFp),
  buildFeedbackFingerprint(baseFp),
  "same inputs → same fingerprint (time not included)"
);
assert.notEqual(
  buildFeedbackFingerprint(baseFp),
  buildFeedbackFingerprint({ ...baseFp, reviewedByUserId: "user_2" }),
  "different author → distinct example"
);
assert.notEqual(
  buildFeedbackFingerprint(baseFp),
  buildFeedbackFingerprint({ ...baseFp, finalQualification: "UNQUALIFIED" }),
  "different correction → distinct example"
);
assert.notEqual(
  buildFeedbackFingerprint(baseFp),
  buildFeedbackFingerprint({ ...baseFp, organizationId: "org_2" }),
  "tenant isolation: different org → distinct fingerprint"
);
// Reason normalization (trim + lowercase) so trivial whitespace/case is deduped.
assert.equal(
  buildFeedbackFingerprint(baseFp),
  buildFeedbackFingerprint({ ...baseFp, finalReason: "  strong fit  " }),
  "reason is normalized for fingerprinting"
);

console.log("PASS feedback fingerprint dedup policy");

// ---------------------------------------------------------------------------
// 2. UNCERTAIN is not a valid final qualification (Invariant 7)
// ---------------------------------------------------------------------------

assert.equal(isFeedbackFinalQualification("QUALIFIED"), true);
assert.equal(isFeedbackFinalQualification("UNQUALIFIED"), true);
assert.equal(isFeedbackFinalQualification("NEEDS_REVIEW"), true);
assert.equal(isFeedbackFinalQualification("COMPANY_QUALIFIED_NEEDS_CONTACT"), true);
assert.equal(
  isFeedbackFinalQualification("UNCERTAIN"),
  false,
  "UNCERTAIN is deprecated and must not be a writable final qualification"
);
assert.ok(
  !FEEDBACK_FINAL_QUALIFICATIONS.includes("UNCERTAIN"),
  "UNCERTAIN absent from canonical final-qualification set"
);

console.log("PASS UNCERTAIN rejected as feedback final qualification");

// ---------------------------------------------------------------------------
// Mock feedback DB
// ---------------------------------------------------------------------------

function makeFeedbackDb({ lead = null, existing = null } = {}) {
  const inserts = [];
  const tx = {
    async $queryRawUnsafe(query, ...values) {
      if (query.includes('FROM "V2LeadAssignment"')) {
        return lead ? [lead] : [];
      }
      if (query.includes('INSERT INTO "V2FeedbackExample"')) {
        const row = {
          id: values[0],
          organizationId: values[1],
          leadAssignmentId: values[2],
          icpVersionId: values[3],
          hardRuleAssessmentId: values[4],
          reviewedByUserId: values[5],
          source: values[6],
          predictedFitScore: values[7],
          predictedQualification: values[8],
          predictedCompanyType: values[9],
          predictedReason: values[10],
          finalFitScore: values[11],
          finalQualification: values[12],
          finalCompanyType: values[13],
          finalReason: values[14],
          rawExampleJson: values[17],
          approvedForLearning: values[18],
          datasetSplit: values[19],
          createdAt: new Date().toISOString(),
        };
        inserts.push(row);
        return [row];
      }
      // SELECT ... FROM "V2FeedbackExample" (fingerprint lookup)
      return existing ? [existing] : [];
    },
  };
  const db = {
    $queryRawUnsafe: tx.$queryRawUnsafe,
    async $transaction(fn) {
      return fn(tx);
    },
  };
  return { db, inserts };
}

const sampleLead = {
  icpVersionId: "icp_1",
  latestHardRuleAssessmentId: "asmt_1",
  predictedFitScore: 40,
  predictedQualification: "NEEDS_REVIEW",
  predictedCompanyType: "smb",
  predictedReason: "Borderline; missing persona evidence",
};

// ---------------------------------------------------------------------------
// 3. Created: predicted snapshot from assessment, final = human truth
// ---------------------------------------------------------------------------

{
  const { db, inserts } = makeFeedbackDb({ lead: sampleLead });
  const result = await createFeedbackExample(
    {
      organizationId: "org_1",
      leadAssignmentId: "la_1",
      reviewedByUserId: "user_1",
      finalQualification: "QUALIFIED",
      finalFitScore: 85,
      finalReason: "Confirmed ICP fit after call",
      approvedForLearning: true,
      datasetSplit: "TRAIN",
    },
    db
  );
  assert.equal(result.kind, "created", "valid feedback is created");
  assert.equal(inserts.length, 1, "exactly one feedback row inserted");
  assert.equal(result.example.finalQualification, "QUALIFIED");
  assert.equal(result.example.finalFitScore, 85);
  // Predicted snapshot is carried from the immutable assessment, untouched.
  assert.equal(result.example.predictedQualification, "NEEDS_REVIEW");
  assert.equal(result.example.predictedFitScore, 40);
  assert.equal(result.example.hardRuleAssessmentId, "asmt_1");
  assert.equal(result.example.icpVersionId, "icp_1");
  assert.equal(result.example.approvedForLearning, true);
  assert.equal(result.example.datasetSplit, "TRAIN");
}

console.log("PASS created: predicted snapshot preserved, final = human truth");

// ---------------------------------------------------------------------------
// 4. Duplicate fingerprint → no-op (no second insert)
// ---------------------------------------------------------------------------

{
  const existing = { id: "fbk_existing", finalQualification: "QUALIFIED" };
  const { db, inserts } = makeFeedbackDb({ lead: sampleLead, existing });
  const result = await createFeedbackExample(
    {
      organizationId: "org_1",
      leadAssignmentId: "la_1",
      reviewedByUserId: "user_1",
      finalQualification: "QUALIFIED",
      finalFitScore: 85,
      finalReason: "Confirmed ICP fit after call",
    },
    db
  );
  assert.equal(result.kind, "duplicate", "identical feedback is deduped");
  assert.equal(result.example.id, "fbk_existing");
  assert.equal(inserts.length, 0, "duplicate does NOT insert a second row (Invariant 6)");
}

console.log("PASS duplicate feedback is a no-op");

// ---------------------------------------------------------------------------
// 5. Lead not found in tenant → lead_not_found (no insert)
// ---------------------------------------------------------------------------

{
  const { db, inserts } = makeFeedbackDb({ lead: null });
  const result = await createFeedbackExample(
    {
      organizationId: "org_1",
      leadAssignmentId: "la_missing",
      reviewedByUserId: "user_1",
      finalQualification: "QUALIFIED",
    },
    db
  );
  assert.equal(result.kind, "lead_not_found");
  assert.equal(inserts.length, 0);
}

console.log("PASS lead-not-found tenant guard");

// ---------------------------------------------------------------------------
// 6. Invalid inputs rejected before any DB write
// ---------------------------------------------------------------------------

{
  const { db, inserts } = makeFeedbackDb({ lead: sampleLead });
  const uncertain = await createFeedbackExample(
    {
      organizationId: "org_1",
      leadAssignmentId: "la_1",
      reviewedByUserId: "user_1",
      finalQualification: "UNCERTAIN",
    },
    db
  );
  assert.equal(uncertain.kind, "invalid");
  assert.equal(uncertain.code, "INVALID_FINAL_QUALIFICATION");

  const badScore = await createFeedbackExample(
    {
      organizationId: "org_1",
      leadAssignmentId: "la_1",
      reviewedByUserId: "user_1",
      finalQualification: "QUALIFIED",
      finalFitScore: 150,
    },
    db
  );
  assert.equal(badScore.kind, "invalid");
  assert.equal(badScore.code, "INVALID_FINAL_FIT_SCORE");

  assert.equal(inserts.length, 0, "invalid inputs never reach insert");
}

console.log("PASS invalid inputs rejected pre-write");

// ---------------------------------------------------------------------------
// 7. Source guards: route permission + immutability
// ---------------------------------------------------------------------------

const routeSrc = readFileSync(resolve(rootDir, "app/v2/feedback/submit/route.ts"), "utf8");
assert.ok(
  routeSrc.includes('requirePermission("feedback.write")'),
  "feedback route gates on feedback.write (Invariant 5)"
);
assert.ok(
  routeSrc.includes("reviewedByUserId: tenantContext.userId"),
  "reviewer is the authenticated user, not a client param"
);

const createSrc = readFileSync(
  resolve(rootDir, "lib/v2/feedback/createFeedbackExample.ts"),
  "utf8"
);
assert.ok(
  !/UPDATE\s+"V2HardRuleAssessment"|UPDATE\s+"V2ICPVersion"/i.test(createSrc),
  "feedback capture must never mutate assessment or ICP rules (Invariant 4)"
);
assert.ok(
  createSrc.includes('INSERT INTO "V2FeedbackExample"'),
  "feedback capture inserts only into V2FeedbackExample"
);

const permsSrc = readFileSync(resolve(rootDir, "lib/v2/tenant/permissions.ts"), "utf8");
assert.ok(
  permsSrc.includes('"feedback.write"'),
  "feedback.write is registered in the permission role policy"
);

console.log("PASS route permission + immutability guards");

console.log(
  "PASS V2 M3 feedback capture smoke (fingerprint, UNCERTAIN-reject, snapshot, dedup, tenant, immutability)"
);

// ---------------------------------------------------------------------------
// Loader (same pattern as other check scripts)
// ---------------------------------------------------------------------------

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled
    .split("import.meta.url").join(moduleUrl)
    .split("import.meta").join(`({ url: ${moduleUrl} })`);

  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/server/prisma" || specifier.endsWith("lib/server/prisma")) {
      return { prisma: null };
    }
    if (specifier.startsWith("@/")) {
      return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    }
    if (specifier.startsWith(".")) {
      return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    }
    return require(specifier);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) {
      return loadTsModule(candidate.slice(rootDir.length + 1));
    }
  }
  return require(base);
}
