// CTD tracking-token + link-rewrite smoke — pure.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { signTrackingToken, verifyTrackingToken } = loadTsModule("lib/v2/outreach/tracking/trackingToken.ts");
const { rewriteBodyForTracking } = loadTsModule("lib/v2/outreach/tracking/rewriteLinksForTracking.ts");

const SECRET = "a-strong-tracking-secret-key";

// roundtrip
{
  const t = signTrackingToken({ kind: "open", messageId: "omsg_1" }, SECRET);
  const p = verifyTrackingToken(t, SECRET);
  assert.equal(p.kind, "open");
  assert.equal(p.messageId, "omsg_1");
}
// tamper -> null
{
  const t = signTrackingToken({ kind: "unsub", messageId: "omsg_2" }, SECRET);
  assert.equal(verifyTrackingToken(t.slice(0, -2) + "xy", SECRET), null);
  assert.equal(verifyTrackingToken(t, "wrong-secret"), null);
  assert.equal(verifyTrackingToken("garbage", SECRET), null);
}
console.log("PASS tracking-token sign/verify + tamper rejection");

// link rewrite: wraps http(s), injects pixel, collects links, no open redirect leak
{
  let n = 0;
  const r = rewriteBodyForTracking({
    body: "Hi, see https://acme.com/a and http://x.io/b — thanks",
    baseUrl: "https://app.example.com/",
    openToken: "OPENTOK",
    generateClickToken: () => `clk_${++n}`,
  });
  assert.equal(r.links.length, 2);
  assert.deepEqual(r.links.map((l) => l.targetUrl), ["https://acme.com/a", "http://x.io/b"]);
  assert.ok(r.body.includes("https://app.example.com/v2/outreach/track/c/clk_1"));
  assert.ok(r.body.includes("/v2/outreach/track/o/OPENTOK"));
  assert.ok(!r.body.includes("https://acme.com/a"), "original target removed from body (lives in DB)");
  // idempotent: re-running does not double-wrap our own links
  const r2 = rewriteBodyForTracking({ body: r.body, baseUrl: "https://app.example.com", openToken: "T2", generateClickToken: () => "should_not_use" });
  assert.equal(r2.links.length, 0, "tracking links are not re-wrapped");
}
console.log("PASS link rewrite (wrap + pixel + persistable links + idempotent)");

console.log("PASS V2 CTD tracking-token + rewrite smoke");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s.startsWith("@/")) return resolveAndLoad(resolve(rootDir, s.slice(2)));
    if (s.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), s));
    return require(s);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1));
  return require(base);
}
