import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O5s smoke: daily warmup tick (B9) + IMAP UID watermark (exactly-once inbound).
// Pure: no DB/network.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const wt = loadTsModule("lib/v2/outreach/worker/warmupTick.ts");
const wm = loadTsModule("lib/v2/outreach/inbound/imapWatermark.ts");

const sender = (over) => ({
  id: "s", kind: "MAILBOX", status: "ACTIVE", dailyCapCurrent: 100, dailyCapTarget: 500,
  warmupStage: 3, bounceRate: 0.005, complaintRate: 0, sentToday: 0, lastSendAt: null, ...over,
});

// 1. Warmup tick: healthy ramps up; unhealthy rolls back; relay unchanged
const results = wt.computeWarmupTick([
  sender({ id: "healthy", windowHealthy: true, dailyCapCurrent: 100 }),
  sender({ id: "bad", windowHealthy: false, dailyCapCurrent: 200 }),
  sender({ id: "relay", kind: "RELAY", dailyCapTarget: 5000, windowHealthy: true }),
]);
const byId = Object.fromEntries(results.map((r) => [r.senderId, r.update]));
assert.ok(byId.healthy.dailyCapCurrent > 100 && !byId.healthy.rolledBack, "healthy mailbox ramps up");
assert.ok(byId.bad.rolledBack && byId.bad.status === "DEGRADED", "unhealthy mailbox rolls back + degrades");
assert.equal(byId.relay.rolledBack, false, "relay does not warm up");
console.log("PASS B9 warmup tick (ramp up / roll back / relay unchanged)");

// 2. IMAP watermark: fetch only UIDs above last seen; advance never goes backward
assert.deepEqual(wm.nextUidsToFetch({ lastSeenUid: 0 }, [3, 1, 2]), [1, 2, 3], "first poll fetches all, ascending");
assert.deepEqual(wm.nextUidsToFetch({ lastSeenUid: 2 }, [1, 2, 3, 4]), [3, 4], "only UIDs above watermark");
assert.deepEqual(wm.nextUidsToFetch({ lastSeenUid: 5 }, [1, 2, 3]), [], "nothing new -> no reprocessing");
assert.deepEqual(wm.nextUidsToFetch({ lastSeenUid: 0 }, [5, 6, 7], 2), [5, 6], "batch cap respected");
assert.equal(wm.advanceWatermark({ lastSeenUid: 2 }, [3, 4]).lastSeenUid, 4, "advances to highest processed");
assert.equal(wm.advanceWatermark({ lastSeenUid: 9 }, [3, 4]).lastSeenUid, 9, "never moves backward");
console.log("PASS IMAP watermark (exactly-once inbound, no reprocessing)");
console.log("PASS V2 outreach worker warmup + watermark (O5s)");

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
