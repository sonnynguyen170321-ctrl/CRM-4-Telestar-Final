import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O8 smoke: outreach report aggregation; per-sender health/volume vs cap; counts
// match source rows. Open/click are hidden unless verified CTD tracking provides
// real human event counts.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { buildOutreachReport } = loadTsModule("lib/v2/outreach/reporting/buildOutreachReport.ts");

const sender = (over) => ({ id: "s", kind: "MAILBOX", status: "ACTIVE", dailyCapCurrent: 100, dailyCapTarget: 500, warmupStage: 5, bounceRate: 0.01, complaintRate: 0, sentToday: 0, lastSendAt: null, ...over });

const report = buildOutreachReport({
  messageCounts: { sent: 4, bounced: 1 },
  activityCounts: { replied: 1, meetingsBooked: 1, unsubscribed: 1 },
  senders: [sender({ id: "m1", sentToday: 50, dailyCapCurrent: 100 }), sender({ id: "relay", kind: "RELAY", dailyCapTarget: 5000, sentToday: 2500, bounceRate: 0.2 })],
  suppressionBlocks: 7,
});

assert.equal(report.totals.sent, 4, "sent from messageCounts");
assert.equal(report.totals.bounced, 1);
assert.equal(report.totals.delivered, 3);
assert.equal(report.totals.bounceRate, Number((1 / 4).toFixed(4)));
assert.equal(report.totals.replied, 1);
assert.equal(report.totals.meetingsBooked, 1);
assert.equal(report.totals.unsubscribed, 1);
assert.equal(report.totals.suppressionBlocks, 7);
console.log("PASS report totals match source rows");

const m1 = report.perSender.find((s) => s.senderId === "m1");
assert.equal(m1.effectiveCap, 100);
assert.equal(m1.capUtilization, 0.5);
assert.equal(m1.healthy, true);
const relay = report.perSender.find((s) => s.senderId === "relay");
assert.equal(relay.effectiveCap, 5000);
assert.equal(relay.healthy, false, "high bounce rate -> unhealthy");
console.log("PASS per-sender health + volume vs cap");

assert.equal(report.tracking.available, false, "tracking hidden when no verified CTD analytics are supplied");
assert.ok(!JSON.stringify(report.tracking).match(/uniqueOpen|uniqueClick|openRate|clickRate/i), "no fabricated open/click metrics when unavailable");
console.log("PASS no fabricated open/click metrics when tracking unavailable");

const tracked = buildOutreachReport({
  messageCounts: { sent: 10, bounced: 2 },
  activityCounts: { replied: 0, meetingsBooked: 0, unsubscribed: 0 },
  senders: [],
  tracking: { trackingEnabled: true, uniqueOpens: 4, uniqueClicks: 2, totalOpens: 7, totalClicks: 3 },
});
assert.equal(tracked.tracking.available, true);
assert.equal(tracked.tracking.uniqueOpens, 4);
assert.equal(tracked.tracking.uniqueClicks, 2);
assert.equal(tracked.tracking.openRate, 0.5, "4 unique opens / 8 delivered");
assert.equal(tracked.tracking.clickRate, 0.25, "2 unique clicks / 8 delivered");
console.log("PASS verified CTD tracking metrics surface real counts");
console.log("PASS V2 outreach reporting (O8)");

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
