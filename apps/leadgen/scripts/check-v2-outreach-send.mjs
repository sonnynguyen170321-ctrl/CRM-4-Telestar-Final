import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O4 smoke: the manual-send core — high-entropy Message-ID (B3), List-Unsubscribe
// (B4), deterministic idempotency (B13), exactly-once send state machine (B2), and
// the Link A outreach activity (B7). Pure: no DB, no network.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const mid = loadTsModule("lib/v2/outreach/send/messageId.ts");
const sm = loadTsModule("lib/v2/outreach/send/sendStateMachine.ts");
const build = loadTsModule("lib/v2/outreach/send/buildOutreachMessage.ts");

// 1. High-entropy Message-ID + List-Unsubscribe (B3/B4)
const m1 = mid.generateMessageId("telestar.io");
const m2 = mid.generateMessageId("telestar.io");
assert.match(m1, /^<[0-9a-f]{32}@telestar\.io>$/, "Message-ID is 128-bit hex @ domain");
assert.notEqual(m1, m2, "Message-IDs are unique");
const lu = mid.buildListUnsubscribe({ unsubscribeMailto: "unsub@telestar.io", oneClickUrl: "https://t.io/u/abc" });
assert.ok(lu.includes("<mailto:unsub@telestar.io>") && lu.includes("<https://t.io/u/abc>"), "List-Unsubscribe has mailto + one-click");
console.log("PASS B3/B4 high-entropy Message-ID + List-Unsubscribe");

// 2. Deterministic idempotency keys (B13)
const k1 = build.buildManualSendIdempotencyKey({ organizationId: "o", leadAssignmentId: "la", sendRequestId: "r1" });
assert.equal(k1, build.buildManualSendIdempotencyKey({ organizationId: "o", leadAssignmentId: "la", sendRequestId: "r1" }), "same inputs -> same key");
assert.notEqual(k1, build.buildManualSendIdempotencyKey({ organizationId: "o", leadAssignmentId: "la", sendRequestId: "r2" }));
assert.ok(build.buildSequenceSendIdempotencyKey({ organizationId: "o", enrollmentId: "e", sequenceStepId: "s" }).includes("enr:e:step:s"));
console.log("PASS B13 deterministic idempotency keys");

// 3. Exactly-once send state machine (B2)
const stale = new Date(Date.now() - 10 * 60 * 1000);
const fresh = new Date(Date.now() - 1000);
assert.equal(sm.decideSendAction({ status: "QUEUED", providerMessageId: null, sendingAt: null }), "send");
assert.equal(sm.decideSendAction({ status: "FAILED", providerMessageId: null, sendingAt: null }), "send");
assert.equal(sm.decideSendAction({ status: "SENT", providerMessageId: "<m@x>", sendingAt: null }), "skip_already_sent");
assert.equal(sm.decideSendAction({ status: "REPLIED", providerMessageId: "<m@x>", sendingAt: null }), "skip_already_sent");
assert.equal(sm.decideSendAction({ status: "SENDING", providerMessageId: "<m@x>", sendingAt: fresh }), "skip_in_flight", "handed to SMTP, recent -> wait");
assert.equal(sm.decideSendAction({ status: "SENDING", providerMessageId: "<m@x>", sendingAt: stale }), "reconcile", "handed to SMTP, stale -> reconcile (never stuck, never re-sent)");
assert.equal(sm.decideSendAction({ status: "SENDING", providerMessageId: null, sendingAt: fresh }), "skip_in_flight", "fresh claim, no msgid -> wait");
assert.equal(sm.decideSendAction({ status: "SENDING", providerMessageId: null, sendingAt: stale }), "retry_stale", "abandoned claim, no msgid -> single retry");
console.log("PASS B2 exactly-once send state machine (incl. stuck-SENDING reconciliation)");

// 4. applySendResult: accepted -> SENT; sync bounce -> BOUNCED + suppress; else FAILED
assert.equal(sm.applySendResult({ accepted: true, providerMessageId: "<m@x>" }).status, "SENT");
const bounced = sm.applySendResult({ accepted: false, providerMessageId: "<m@x>", syncBounce: true, error: "550 5.1.1 no such user" });
assert.equal(bounced.status, "BOUNCED");
assert.equal(bounced.createSuppression, true, "sync hard bounce -> suppress future sends (Link B)");
const failed = sm.applySendResult({ accepted: false, providerMessageId: "<m@x>", syncBounce: false, error: "timeout" });
assert.equal(failed.status, "FAILED");
assert.equal(failed.createSuppression, false);
console.log("PASS B2 applySendResult (sent/bounce-suppress/failed)");

// 5. Link A outreach activity (B7) + provider request headers
const act = build.buildOutreachActivity({ organizationId: "o", leadAssignmentId: "la", contactId: "c", eventKind: "outreach.sent", messageId: "msg1" });
for (const f of ["leadAssignmentId", "occurredAt", "eventKind", "channel"]) assert.ok(f in act, `activity has Link A field ${f}`);
assert.equal(act.channel, "email");
assert.equal(act.eventKind, "outreach.sent");
const req = build.buildProviderRequest({ draft: { fromAddress: "a@t.io", fromName: "A", toAddress: "b@y.io", subject: "Hi", body: "Body", listUnsubscribeToken: "tok" }, messageId: "<m@t.io>", unsubscribeMailto: "unsub@t.io" });
assert.ok(req.headers["List-Unsubscribe"].includes("unsub@t.io"), "provider request carries List-Unsubscribe (B4)");
assert.equal(req.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
console.log("PASS B7 Link A outreach activity + List-Unsubscribe header on send");
console.log("PASS V2 outreach manual send core (O4)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(absolutePath), specifier);
      for (const c of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1));
    }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
