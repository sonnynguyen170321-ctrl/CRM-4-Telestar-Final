import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O5 smoke: sequence policy — idempotent enrollment, halt rules (reply/bounce/
// meeting/max-touches), next-step decision, send window (B8). Pure: no DB/network.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const sp = loadTsModule("lib/v2/outreach/sequences/sequencePolicy.ts");

// 1. Idempotent enrollment key
const k = sp.buildEnrollmentIdempotencyKey({ organizationId: "o", sequenceId: "seq", leadAssignmentId: "la" });
assert.equal(k, sp.buildEnrollmentIdempotencyKey({ organizationId: "o", sequenceId: "seq", leadAssignmentId: "la" }));
assert.ok(k.includes("o:seq:la"));

// 2. Halt rules
const cfg = { stopOnReply: true, stopOnBounce: true, stopOnMeeting: true, maxTouches: 3 };
assert.equal(sp.shouldHalt(cfg, { status: "ACTIVE", currentStepOrdinal: 0 }, { bounced: true }), "bounced");
assert.equal(sp.shouldHalt(cfg, { status: "ACTIVE", currentStepOrdinal: 0 }, { replied: true }), "replied");
assert.equal(sp.shouldHalt(cfg, { status: "ACTIVE", currentStepOrdinal: 0 }, { meetingBooked: true }), "meeting_booked");
assert.equal(sp.shouldHalt(cfg, { status: "ACTIVE", currentStepOrdinal: 3, touchesSent: 3 }, {}), "max_touches");
assert.equal(sp.shouldHalt(cfg, { status: "ACTIVE", currentStepOrdinal: 0 }, {}), null);
assert.equal(sp.shouldHalt({ ...cfg, stopOnReply: false }, { status: "ACTIVE", currentStepOrdinal: 0 }, { replied: true }), null, "respects stopOnReply=false");
console.log("PASS halt rules (reply/bounce/meeting/max-touches + config toggles)");

// 3. decideNextStep
const steps = [
  { ordinal: 0, kind: "EMAIL", delayMinutes: 0 },
  { ordinal: 1, kind: "WAIT", delayMinutes: 2880 },
  { ordinal: 2, kind: "EMAIL", delayMinutes: 0 },
];
const base = { config: cfg, steps };

assert.equal(sp.decideNextStep({ ...base, enrollment: { status: "ACTIVE", currentStepOrdinal: 0 } }).action, "execute");
assert.equal(sp.decideNextStep({ ...base, enrollment: { status: "HALTED", currentStepOrdinal: 0 } }).action, "noop", "non-active -> noop");
assert.equal(sp.decideNextStep({ ...base, enrollment: { status: "ACTIVE", currentStepOrdinal: 0 }, signals: { bounced: true } }).action, "halt", "bounce halts before executing");
const wait = sp.decideNextStep({ ...base, enrollment: { status: "ACTIVE", currentStepOrdinal: 1 } });
assert.equal(wait.action, "wait");
assert.equal(wait.ordinal, 2);
assert.ok(wait.nextStepAt instanceof Date);
assert.equal(sp.decideNextStep({ ...base, enrollment: { status: "ACTIVE", currentStepOrdinal: 3 } }).action, "complete", "past last step -> complete");
console.log("PASS decideNextStep (execute/noop/halt/wait/complete)");

// 4. Send window (B8) — defer outside business hours
const window = { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5], utcOffsetMinutes: 0 };
const monday10 = new Date(Date.UTC(2026, 5, 15, 10, 0, 0)); // Mon 10:00 UTC
const monday3am = new Date(Date.UTC(2026, 5, 15, 3, 0, 0)); // Mon 03:00 UTC
const saturday10 = new Date(Date.UTC(2026, 5, 13, 10, 0, 0)); // Sat
assert.equal(sp.isWithinSendWindow(monday10, window), true);
assert.equal(sp.isWithinSendWindow(monday3am, window), false, "3am is outside window");
assert.equal(sp.isWithinSendWindow(saturday10, window), false, "weekend excluded");
const next = sp.nextWindowOpen(monday3am, window);
assert.ok(sp.isWithinSendWindow(next, window), "nextWindowOpen lands inside the window");
const stepWindowed = [{ ordinal: 0, kind: "EMAIL", delayMinutes: 0, sendWindow: window }];
assert.equal(sp.decideNextStep({ config: cfg, steps: stepWindowed, enrollment: { status: "ACTIVE", currentStepOrdinal: 0 }, now: monday3am }).action, "defer", "outside window -> defer");
assert.equal(sp.decideNextStep({ config: cfg, steps: stepWindowed, enrollment: { status: "ACTIVE", currentStepOrdinal: 0 }, now: monday10 }).action, "execute", "inside window -> execute");
console.log("PASS B8 send window (defer outside business hours, execute inside)");
console.log("PASS V2 outreach sequences (O5)");

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
