// M2 review → rescore bridge smoke — pure, no network, no real DB.
// Proves: identity correction (LINK_EXISTING) enqueues exactly one idempotent
// ICP_SCORE for the lead; note-only / workflow-only resolutions enqueue none;
// reruns do not duplicate jobs; old assessment is never mutated (we only ENQUEUE).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { resolutionChangesScoringInput, enqueueRescoreForResolution } =
  loadTsModule("lib/v2/manager-review/resolveReviewItem.ts");
const { createPayloadEnvelope } = loadTsModule("lib/v2/jobs/payloadEnvelope.ts");
const { SCORE_HV0_JOB_SCHEMA_VERSION } = loadTsModule(
  "lib/v2/scoring/runtime/types.ts"
);

// ---------------------------------------------------------------------------
// 1. resolutionChangesScoringInput pure predicate
// ---------------------------------------------------------------------------

assert.equal(
  resolutionChangesScoringInput({ resolutionType: "LINK_EXISTING" }),
  true,
  "LINK_EXISTING changes scoring input (identity re-link)"
);
for (const rt of [
  "APPROVE_CONFIRM",
  "REJECT_DISMISS",
  "REQUEST_CHANGES",
  "NO_ACTION_NON_ACTIONABLE",
  "CONVERT_TO_FEEDBACK_LATER",
  "CREATE_MISSING_ENTITY_LATER",
  "UPDATE_WORKFLOW_STATUS_LATER",
]) {
  assert.equal(
    resolutionChangesScoringInput({ resolutionType: rt }),
    false,
    `${rt} does not change scoring input`
  );
}

// Invariant 3: workflow-status change is not a scoring-input change.
assert.equal(
  resolutionChangesScoringInput({ resolutionType: "UPDATE_WORKFLOW_STATUS_LATER" }),
  false,
  "workflow-status resolution must not trigger rescore (qualification != workflow)"
);

// Metadata override wins both ways.
assert.equal(
  resolutionChangesScoringInput({
    resolutionType: "APPROVE_CONFIRM",
    resolutionMetadataJson: { rescore: true },
  }),
  true,
  "explicit rescore:true overrides a non-link resolution type"
);
assert.equal(
  resolutionChangesScoringInput({
    resolutionType: "LINK_EXISTING",
    resolutionMetadataJson: { rescore: false },
  }),
  false,
  "explicit rescore:false overrides LINK_EXISTING"
);

console.log("PASS resolutionChangesScoringInput predicate");

// ---------------------------------------------------------------------------
// Mock job DB (tagged-template $queryRaw, same shape as Prisma)
// ---------------------------------------------------------------------------

function makeJobDb({ existing = null } = {}) {
  const inserts = [];
  const db = {
    async $queryRaw(strings, ...values) {
      const sql = strings.join("?");
      if (sql.includes('INSERT INTO "V2Job"')) {
        const row = {
          id: values[0],
          organizationId: values[1],
          jobType: values[2],
          sourceType: values[3],
          sourceId: values[4],
          status: "QUEUED",
          idempotencyKey: values[5],
          // values[6] is JSON.stringify(envelope) (cast ::jsonb in SQL)
          payloadSnapshotJson: JSON.parse(values[6]),
        };
        inserts.push(row);
        return [row];
      }
      // existing-job lookup
      return existing ? [existing] : [];
    },
    async $executeRaw() {
      return 0;
    },
    async $transaction(fn) {
      return fn(db);
    },
  };
  return { db, inserts };
}

const item = { id: "rev_1", leadAssignmentId: "la_1" };

// ---------------------------------------------------------------------------
// 2. Identity correction enqueues exactly one rescore for the lead
// ---------------------------------------------------------------------------

{
  const { db, inserts } = makeJobDb();
  const outcome = await enqueueRescoreForResolution(db, {
    organizationId: "org_1",
    item,
    resolutionType: "LINK_EXISTING",
    actorUserId: "user_1",
  });
  assert.equal(outcome.enqueued, true, "LINK_EXISTING enqueues a rescore");
  assert.equal(outcome.deduped, false, "first enqueue is freshly created");
  assert.equal(inserts.length, 1, "exactly one ICP_SCORE job inserted");
  assert.equal(inserts[0].jobType, "ICP_SCORE", "job type is ICP_SCORE");
  assert.equal(inserts[0].organizationId, "org_1", "tenant-scoped to resolution org");
  assert.equal(inserts[0].sourceId, "rev_1", "rescore is bound to the review item id");

  const selection = inserts[0].payloadSnapshotJson.payload.selection;
  assert.equal(selection.kind, "lead_assignment_ids");
  assert.deepEqual(
    selection.leadAssignmentIds,
    ["la_1"],
    "rescore selects the corrected lead assignment"
  );
  assert.equal(
    inserts[0].payloadSnapshotJson.payload.schemaVersion,
    SCORE_HV0_JOB_SCHEMA_VERSION
  );
}

console.log("PASS identity correction → exactly one ICP_SCORE for the lead");

// ---------------------------------------------------------------------------
// 3. Note-only / workflow-only resolutions enqueue nothing
// ---------------------------------------------------------------------------

for (const rt of ["APPROVE_CONFIRM", "REJECT_DISMISS", "UPDATE_WORKFLOW_STATUS_LATER"]) {
  const { db, inserts } = makeJobDb();
  const outcome = await enqueueRescoreForResolution(db, {
    organizationId: "org_1",
    item,
    resolutionType: rt,
    actorUserId: "user_1",
  });
  assert.equal(outcome.enqueued, false, `${rt} enqueues nothing`);
  assert.equal(
    outcome.reason,
    "not_scoring_input_change",
    `${rt} reason is not_scoring_input_change`
  );
  assert.equal(inserts.length, 0, `${rt} inserts no job`);
}

console.log("PASS note-only / workflow-only resolutions enqueue no rescore");

// ---------------------------------------------------------------------------
// 4. No leadAssignment → no rescore (cannot score a company globally, Invariant 2)
// ---------------------------------------------------------------------------

{
  const { db, inserts } = makeJobDb();
  const outcome = await enqueueRescoreForResolution(db, {
    organizationId: "org_1",
    item: { id: "rev_2", leadAssignmentId: null },
    resolutionType: "LINK_EXISTING",
    actorUserId: "user_1",
  });
  assert.equal(outcome.enqueued, false);
  assert.equal(outcome.reason, "no_lead_assignment");
  assert.equal(inserts.length, 0);
}

console.log("PASS no-lead-assignment resolution does not rescore");

// ---------------------------------------------------------------------------
// 5. Rerun does not duplicate jobs (idempotency-keyed by org + lead ids)
// ---------------------------------------------------------------------------

{
  // Existing job whose payload matches what the bridge will build for this lead.
  const expectedPayload = {
    schemaVersion: SCORE_HV0_JOB_SCHEMA_VERSION,
    selection: { kind: "lead_assignment_ids", leadAssignmentIds: ["la_1"] },
  };
  const existing = {
    id: "job_existing",
    organizationId: "org_1",
    jobType: "ICP_SCORE",
    sourceType: "MANUAL",
    sourceId: "rev_1",
    status: "QUEUED",
    idempotencyKey: "icp-score:org_1:lead-ids:whatever",
    payloadSnapshotJson: createPayloadEnvelope(expectedPayload),
  };
  const { db, inserts } = makeJobDb({ existing });
  const outcome = await enqueueRescoreForResolution(db, {
    organizationId: "org_1",
    item,
    resolutionType: "LINK_EXISTING",
    actorUserId: "user_1",
  });
  assert.equal(outcome.enqueued, true, "existing job is treated as enqueued");
  assert.equal(outcome.deduped, true, "rerun is deduped to the existing job");
  assert.equal(outcome.jobId, "job_existing", "returns the existing job id");
  assert.equal(inserts.length, 0, "rerun does NOT insert a second job (Invariant 6)");
}

console.log("PASS rerun does not duplicate the rescore job");

// ---------------------------------------------------------------------------
// 6. Source guards: bridge wired into resolveReviewItem; reuses scoring enqueue
// ---------------------------------------------------------------------------

const resolveSrc = readFileSync(
  resolve(rootDir, "lib/v2/manager-review/resolveReviewItem.ts"),
  "utf8"
);
assert.ok(
  resolveSrc.includes("enqueueIcpScoreJob"),
  "resolveReviewItem reuses enqueueIcpScoreJob (no parallel score enqueue path)"
);
assert.ok(
  resolveSrc.includes("enqueueRescoreForResolution") &&
    resolveSrc.includes("rescore"),
  "resolveReviewItem runs the rescore bridge and returns the outcome"
);
assert.ok(
  /runs outside the resolve transaction|outside the resolve transaction/i.test(resolveSrc),
  "bridge documents that enqueue runs after the resolution commits"
);
assert.ok(
  !/UPDATE\s+"V2HardRuleAssessment"/i.test(resolveSrc),
  "bridge must not mutate an existing assessment (Invariant 4)"
);

console.log("PASS bridge wiring + immutability guard");

console.log(
  "PASS V2 M2 review→rescore bridge smoke (identity→rescore, note/workflow→none, idempotent rerun)"
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
