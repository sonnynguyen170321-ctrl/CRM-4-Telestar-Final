// OL5 createManualSend smoke — pure (injected db). Proves a manual compose send
// inserts a QUEUED message + enqueues EMAIL_SEND, and is idempotent on a repeat
// submit (same sendRequestId => same message + job, no duplicate).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { createManualSend } = loadTsModule("lib/v2/outreach/send/createManualSend.ts");

function makeDb() {
  const messages = new Map(); // org|idemKey -> id
  const jobs = [];
  return {
    messages,
    jobs,
    async $executeRawUnsafe(query, ...values) {
      if (query.includes('INSERT INTO "V2OutreachMessage"')) {
        const id = values[0];
        const key = `${values[1]}|${values[5]}`; // org | idempotencyKey
        if (!messages.has(key)) messages.set(key, id); // ON CONFLICT DO NOTHING
      }
      return 1;
    },
    async $queryRawUnsafe(query, ...values) {
      if (query.includes('SELECT "id" FROM "V2OutreachMessage"')) {
        const id = messages.get(`${values[0]}|${values[1]}`);
        return id ? [{ id }] : [];
      }
      return [];
    },
    async $queryRaw(strings, ...values) {
      const sql = strings.join("?");
      if (sql.includes("FROM \"V2Job\"") && sql.includes("SELECT")) {
        const idemKey = values[1];
        const found = jobs.find((j) => j.idempotencyKey === idemKey);
        return found ? [found] : [];
      }
      if (sql.includes('INSERT INTO "V2Job"')) {
        const job = { id: values[0], organizationId: values[1], jobType: values[2], idempotencyKey: values[5], payloadSnapshotJson: values[6] };
        jobs.push(job);
        return [job];
      }
      return [];
    },
  };
}

const input = {
  organizationId: "org_1",
  createdByUserId: "user_1",
  leadAssignmentId: "la_1",
  contactId: "ct_1",
  senderAccountId: "snd_1",
  toAddress: "prospect@example.com",
  subject: "Hello",
  body: "Quick question.",
  sendRequestId: "req_fixed",
};

// 1. First send: message inserted + EMAIL_SEND enqueued referencing it.
{
  const db = makeDb();
  const r = await createManualSend(db, input);
  assert.ok(r.messageId.startsWith("omsg_"), "returns the message id");
  assert.equal(r.enqueued, true);
  assert.equal(db.messages.size, 1, "one message row");
  assert.equal(db.jobs.length, 1, "one EMAIL_SEND job");
  assert.equal(db.jobs[0].jobType, "EMAIL_SEND");
  assert.ok(db.jobs[0].idempotencyKey.includes(r.messageId), "job is keyed by the message id");
  assert.ok(String(db.jobs[0].payloadSnapshotJson).includes(r.messageId), "job payload carries the message id");
}
console.log("PASS manual send inserts a QUEUED message + enqueues EMAIL_SEND");

// 2. Idempotent: same sendRequestId -> same message + job, no duplicates.
{
  const db = makeDb();
  const a = await createManualSend(db, input);
  const b = await createManualSend(db, input);
  assert.equal(a.messageId, b.messageId, "same logical send maps to the same message (B13)");
  assert.equal(db.messages.size, 1, "no duplicate message");
  assert.equal(db.jobs.length, 1, "no duplicate EMAIL_SEND job");
}
console.log("PASS manual send is idempotent on a repeat submit");

console.log("PASS V2 manual send (OL5)");

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
