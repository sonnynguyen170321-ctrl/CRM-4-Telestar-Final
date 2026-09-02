// OL5 (B) sequence authoring smoke — pure logic over an injected fake step table.
// Proves: ordinals are assigned + stay contiguous through remove/move (the
// two-phase resequence never collides), publishing requires >=1 step, and a
// published sequence is no longer editable.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { createSequence, addStep, removeStep, moveStep, publishSequence } = loadTsModule(
  "lib/v2/outreach/sequences/authorSequence.ts"
);

const ORG = "org_1";

function makeDb() {
  const sequences = new Map();
  let steps = [];
  const tx = {
    async $queryRawUnsafe(q, ...v) {
      if (q.includes('FROM "V2Sequence"') && q.includes('"status"::text AS "status"')) {
        const seq = sequences.get(v[0]);
        return seq ? [{ status: seq.status }] : [];
      }
      if (q.includes('COALESCE(MAX("ordinal")')) {
        const m = steps.filter((s) => s.sequenceId === v[1]).reduce((acc, s) => Math.max(acc, s.ordinal), 0);
        return [{ m }];
      }
      if (q.includes('SELECT "id" FROM "V2SequenceStep"') && q.includes('ORDER BY "ordinal"')) {
        return steps.filter((s) => s.sequenceId === v[1]).sort((a, b) => a.ordinal - b.ordinal).map((s) => ({ id: s.id }));
      }
      if (q.includes('COUNT(*)::int AS n FROM "V2SequenceStep"')) {
        return [{ n: steps.filter((s) => s.sequenceId === v[1]).length }];
      }
      return [];
    },
    async $executeRawUnsafe(q, ...v) {
      if (q.includes('INSERT INTO "V2Sequence"')) { sequences.set(v[0], { status: "DRAFT" }); return 1; }
      if (q.includes('INSERT INTO "V2SequenceStep"')) {
        steps.push({ id: v[0], sequenceId: v[2], ordinal: v[3], kind: v[4] });
        return 1;
      }
      if (q.includes('DELETE FROM "V2SequenceStep"')) {
        const before = steps.length; steps = steps.filter((s) => s.id !== v[0]); return before - steps.length;
      }
      if (q.includes('SET "ordinal" = "ordinal" + ')) {
        steps.forEach((s) => { if (s.sequenceId === v[1]) s.ordinal += 100000; });
        return 1;
      }
      if (q.includes('SET "ordinal" = $4')) {
        const s = steps.find((x) => x.id === v[0]); if (s) s.ordinal = v[3]; return s ? 1 : 0;
      }
      if (q.includes("SET \"status\" = 'ACTIVE'")) {
        const seq = sequences.get(v[0]); if (seq && seq.status === "DRAFT") { seq.status = "ACTIVE"; return 1; } return 0;
      }
      return 1;
    },
  };
  return { sequences, get steps() { return steps; }, ...tx, async $transaction(fn) { return fn(tx); } };
}

function ordinals(db, sequenceId) {
  return db.steps.filter((s) => s.sequenceId === sequenceId).sort((a, b) => a.ordinal - b.ordinal).map((s) => s.ordinal);
}
function order(db, sequenceId) {
  return db.steps.filter((s) => s.sequenceId === sequenceId).sort((a, b) => a.ordinal - b.ordinal).map((s) => s.id);
}

// 1. create + add three steps -> ordinals 1,2,3.
const db = makeDb();
const { id: seqId } = await createSequence(db, { organizationId: ORG, name: "Growth Expansion" });
const a = await addStep(db, { organizationId: ORG, sequenceId: seqId, kind: "EMAIL", subjectTemplate: "Hi" });
const b = await addStep(db, { organizationId: ORG, sequenceId: seqId, kind: "WAIT", delayMinutes: 2880 });
const c = await addStep(db, { organizationId: ORG, sequenceId: seqId, kind: "EMAIL", subjectTemplate: "Follow up" });
assert.deepEqual([a.ordinal, b.ordinal, c.ordinal], [1, 2, 3], "steps get sequential ordinals");
assert.deepEqual(ordinals(db, seqId), [1, 2, 3]);
console.log("PASS addStep assigns sequential ordinals");

// 2. remove the middle step -> contiguous 1,2 (no gap, no collision).
await removeStep(db, { organizationId: ORG, sequenceId: seqId, stepId: b.id });
assert.deepEqual(ordinals(db, seqId), [1, 2], "ordinals stay contiguous after remove");
assert.deepEqual(order(db, seqId), [a.id, c.id], "remaining order preserved");
console.log("PASS removeStep re-packs ordinals contiguously");

// 3. move the last step up -> order swaps, ordinals still 1,2.
await moveStep(db, { organizationId: ORG, sequenceId: seqId, stepId: c.id, direction: "up" });
assert.deepEqual(order(db, seqId), [c.id, a.id], "moveStep up swaps order");
assert.deepEqual(ordinals(db, seqId), [1, 2]);
console.log("PASS moveStep reorders without ordinal collision");

// 4. publish requires steps; then status becomes ACTIVE.
{
  const empty = makeDb();
  const { id: emptyId } = await createSequence(empty, { organizationId: ORG, name: "Empty" });
  const r = await publishSequence(empty, { organizationId: ORG, sequenceId: emptyId });
  assert.equal(r.published, false, "cannot publish an empty sequence");
  assert.match(r.reason, /at least one step/);
}
const pub = await publishSequence(db, { organizationId: ORG, sequenceId: seqId });
assert.equal(pub.published, true, "publishes a sequence with steps");
assert.equal(db.sequences.get(seqId).status, "ACTIVE");
console.log("PASS publish gating (needs >=1 step) + DRAFT->ACTIVE");

// 5. a published (non-DRAFT) sequence is not editable.
await assert.rejects(
  () => addStep(db, { organizationId: ORG, sequenceId: seqId, kind: "EMAIL" }),
  /Only DRAFT sequences can be edited/
);
console.log("PASS published sequences are locked from editing");

console.log("PASS V2 sequence authoring (OL5/B)");

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
