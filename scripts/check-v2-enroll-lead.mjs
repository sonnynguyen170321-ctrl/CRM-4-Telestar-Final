// Block 4 enrollment runtime smoke — pure (injected fake db). Proves enrollLead
// validates (sequence ACTIVE + has steps, lead active, contact has email, sender
// active), inserts ONE enrollment + kicks the first SEQUENCE_STEP_EXECUTE, is
// idempotent on a repeat enroll, and that tickDueEnrollments only wakes due rows.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { enrollLead } = loadTsModule("lib/v2/outreach/sequences/enrollLead.ts");
const { tickDueEnrollments } = loadTsModule("lib/v2/outreach/sequences/tickDueEnrollments.ts");

const ORG = "org_1";

// Minimal fake db. World state controls validation branches; enrollments + jobs
// are captured so we can assert side effects.
function makeDb(world = {}) {
  const state = {
    sequenceStatus: world.sequenceStatus ?? "ACTIVE",
    firstOrdinal: "firstOrdinal" in world ? world.firstOrdinal : 1,
    leadActive: world.leadActive ?? true,
    leadContactId: "leadContactId" in world ? world.leadContactId : "ct_1",
    hasEmail: world.hasEmail ?? true,
    senderStatus: world.senderStatus ?? "ACTIVE",
    enrollments: [], // {id, organizationId, sequenceId, leadAssignmentId, status, currentStepOrdinal, nextStepAt}
    jobs: [], // {idempotencyKey, jobType, enrollmentId}
    dueRows: world.dueRows ?? null, // for tick test
  };

  function matchTag(strings) {
    return strings.join("?");
  }

  const db = {
    state,
    async $queryRaw(strings, ...values) {
      const sql = matchTag(strings);
      if (sql.includes('FROM "V2Sequence" s')) {
        return state.sequenceStatus
          ? [{ status: state.sequenceStatus, firstOrdinal: state.firstOrdinal }]
          : [];
      }
      if (sql.includes('FROM "V2LeadAssignment"') && sql.includes('"contactId"')) {
        return state.leadActive ? [{ contactId: state.leadContactId }] : [];
      }
      if (sql.includes('FROM "V2ContactIdentifier"')) {
        return state.hasEmail ? [{ normalizedValue: "prospect@example.com" }] : [];
      }
      if (sql.includes('FROM "V2SenderAccount"')) {
        return [{ status: state.senderStatus }];
      }
      if (sql.includes('INSERT INTO "V2SequenceEnrollment"')) {
        // 'ACTIVE' is a SQL literal, so values are: id, org, seq, lead, contact,
        // sender, currentStepOrdinal, enrolledByUserId.
        const [id, organizationId, sequenceId, leadAssignmentId, contactId, , currentStepOrdinal] = values;
        const exists = state.enrollments.find(
          (e) =>
            e.organizationId === organizationId &&
            e.sequenceId === sequenceId &&
            e.leadAssignmentId === leadAssignmentId
        );
        if (exists) return []; // ON CONFLICT DO NOTHING -> no RETURNING row
        state.enrollments.push({
          id,
          organizationId,
          sequenceId,
          leadAssignmentId,
          contactId,
          status: "ACTIVE",
          currentStepOrdinal,
          nextStepAt: "now",
        });
        return [{ id }];
      }
      if (sql.includes('SELECT "id", "status"::text AS "status"') && sql.includes('FROM "V2SequenceEnrollment"')) {
        const [, sequenceId, leadAssignmentId] = values;
        const found = state.enrollments.find(
          (e) => e.sequenceId === sequenceId && e.leadAssignmentId === leadAssignmentId
        );
        return found ? [{ id: found.id, status: found.status }] : [];
      }
      // tickDueEnrollments SELECT
      if (sql.includes('SELECT "id", "organizationId", "currentStepOrdinal"')) {
        return state.dueRows ?? [];
      }
      // enqueueV2Job existing-check
      if (sql.includes('FROM "V2Job"')) {
        const idemKey = values[1];
        const found = state.jobs.find((j) => j.idempotencyKey === idemKey);
        return found ? [found] : [];
      }
      if (sql.includes('INSERT INTO "V2Job"')) {
        // 'QUEUED'/0/0 are literals, so values are: id, org, jobType, sourceType,
        // sourceId, idempotencyKey, payload, createdByUserId.
        const job = { id: values[0], idempotencyKey: values[5], jobType: values[2] };
        state.jobs.push(job);
        return [job];
      }
      return [];
    },
    async $executeRaw() {
      return 1;
    },
    async $transaction(fn) {
      return fn(db);
    },
  };
  return db;
}

// 1. Happy path: one enrollment + one SEQUENCE_STEP_EXECUTE keyed by first ordinal.
{
  const db = makeDb();
  const r = await enrollLead(db, {
    organizationId: ORG,
    sequenceId: "seq_1",
    leadAssignmentId: "la_1",
    senderAccountId: "snd_1",
  });
  assert.equal(r.enrolled, true, "valid input enrolls");
  assert.equal(db.state.enrollments.length, 1, "one enrollment row");
  assert.equal(db.state.enrollments[0].currentStepOrdinal, 1, "starts at the first step ordinal");
  assert.equal(db.state.jobs.length, 1, "one step job kicked");
  assert.equal(db.state.jobs[0].jobType, "SEQUENCE_STEP_EXECUTE");
  assert.ok(db.state.jobs[0].idempotencyKey.endsWith(":1"), "job key carries the ordinal");
}
console.log("PASS enrollLead inserts one enrollment + kicks the first step");

// 2. Idempotent: re-enroll same (org, sequence, lead) -> already enrolled, no dup.
{
  const db = makeDb();
  const a = await enrollLead(db, { organizationId: ORG, sequenceId: "seq_1", leadAssignmentId: "la_1", senderAccountId: "snd_1" });
  const b = await enrollLead(db, { organizationId: ORG, sequenceId: "seq_1", leadAssignmentId: "la_1", senderAccountId: "snd_1" });
  assert.equal(a.enrolled, true);
  assert.equal(b.enrolled, false, "second enroll is a no-op");
  assert.equal(b.code, "ALREADY_ENROLLED");
  assert.equal(db.state.enrollments.length, 1, "no duplicate enrollment");
  assert.equal(db.state.jobs.length, 1, "no duplicate step job");
}
console.log("PASS enrollLead is idempotent on (org, sequence, lead)");

// 3. Validation branches each refuse with the right code.
{
  const cases = [
    [{ sequenceStatus: "DRAFT" }, "SEQUENCE_NOT_ACTIVE"],
    [{ firstOrdinal: null }, "SEQUENCE_EMPTY"],
    [{ leadActive: false }, "LEAD_NOT_FOUND"],
    [{ leadContactId: null }, "NO_CONTACT"],
    [{ hasEmail: false }, "NO_CONTACT_EMAIL"],
    [{ senderStatus: "PAUSED" }, "SENDER_NOT_ACTIVE"],
  ];
  for (const [world, expectedCode] of cases) {
    const db = makeDb(world);
    const r = await enrollLead(db, { organizationId: ORG, sequenceId: "seq_1", leadAssignmentId: "la_1", senderAccountId: "snd_1" });
    assert.equal(r.enrolled, false, `world ${JSON.stringify(world)} should not enroll`);
    assert.equal(r.code, expectedCode, `world ${JSON.stringify(world)} -> ${expectedCode}`);
    assert.equal(db.state.enrollments.length, 0, "no enrollment on validation failure");
    assert.equal(db.state.jobs.length, 0, "no job on validation failure");
  }
}
console.log("PASS enrollLead refuses each invalid precondition with the right code");

// 4. tickDueEnrollments enqueues one step job per due row, idempotent per ordinal.
{
  const db = makeDb({
    dueRows: [
      { id: "enr_a", organizationId: ORG, currentStepOrdinal: 2 },
      { id: "enr_b", organizationId: ORG, currentStepOrdinal: 1 },
    ],
  });
  const first = await tickDueEnrollments(db);
  assert.equal(first.due, 2, "two due enrollments");
  assert.equal(first.enqueued, 2, "two step jobs created");
  assert.ok(db.state.jobs.some((j) => j.idempotencyKey === "seq-step-exec:enr_a:2"));
  assert.ok(db.state.jobs.some((j) => j.idempotencyKey === "seq-step-exec:enr_b:1"));
  // Second tick before the jobs drain: same keys -> no new jobs.
  const second = await tickDueEnrollments(db);
  assert.equal(second.due, 2, "still two due");
  assert.equal(second.enqueued, 0, "no duplicate jobs on a repeat tick");
  assert.equal(db.state.jobs.length, 2, "job count unchanged");
}
console.log("PASS tickDueEnrollments enqueues one step per due row, idempotent per ordinal");

console.log("PASS V2 sequence enrollment runtime (Block 4)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/server/prisma" || specifier.endsWith("lib/server/prisma")) return { prisma: null };
    if (specifier.startsWith("@/")) return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    if (specifier.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function resolveAndLoad(base) {
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
