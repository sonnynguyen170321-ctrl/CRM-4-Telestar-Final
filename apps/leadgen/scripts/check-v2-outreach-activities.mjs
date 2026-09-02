import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O6 smoke: non-email outreach (call/linkedin) writes Link A timeline events with
// no send risk. Pure.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const a = loadTsModule("lib/v2/outreach/activities/logOutreachActivity.ts");

const call = a.buildCallActivity({ organizationId: "o", leadAssignmentId: "la", contactId: "c", actorUserId: "u", outcome: "connected" });
for (const f of ["leadAssignmentId", "occurredAt", "eventKind", "channel"]) assert.ok(f in call, `call activity has Link A field ${f}`);
assert.equal(call.channel, "call");
assert.equal(call.eventKind, "outreach.call_logged");
assert.equal(call.metadataJson.outcome, "connected");
assert.equal(call.messageId, null, "non-email activity has no message (no send)");

const li = a.buildLinkedinActivity({ organizationId: "o", leadAssignmentId: "la", action: "connection" });
assert.equal(li.channel, "linkedin");
assert.equal(li.eventKind, "outreach.linkedin_connection");

const manual = a.buildManualOutreachActivity({ organizationId: "o", leadAssignmentId: "la", channel: "manual_note", eventKind: "outreach.note" });
assert.equal(manual.channel, "manual_note");
console.log("PASS O6 non-email activities write Link A timeline events (no send risk)");
console.log("PASS V2 outreach non-email activities (O6)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) { const base = resolve(dirname(absolutePath), specifier); for (const c of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1)); }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
