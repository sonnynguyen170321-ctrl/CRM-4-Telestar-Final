// CTD DNS-verify smoke — pure, no network (injected resolver).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { verifyTrackingDomainCname } = loadTsModule(
  "lib/v2/outreach/tracking/verifyTrackingDomain.ts"
);

const TARGET = "track.telestar.app";

// match (trailing dot + case tolerant)
assert.equal((await verifyTrackingDomainCname("inst.acme.com", TARGET, async () => ["track.telestar.app."])).ok, true);
assert.equal((await verifyTrackingDomainCname("inst.acme.com", TARGET, async () => ["TRACK.TELESTAR.APP"])).ok, true);
// mismatch
assert.equal((await verifyTrackingDomainCname("inst.acme.com", TARGET, async () => ["other.host"])).reason, "CNAME_MISMATCH");
// no record
assert.equal((await verifyTrackingDomainCname("inst.acme.com", TARGET, async () => [])).reason, "NO_CNAME");
// NXDOMAIN
assert.equal(
  (await verifyTrackingDomainCname("inst.acme.com", TARGET, async () => { const e = new Error("nxdomain"); e.code = "ENOTFOUND"; throw e; })).reason,
  "NO_CNAME"
);
// other dns error
assert.equal(
  (await verifyTrackingDomainCname("inst.acme.com", TARGET, async () => { const e = new Error("boom"); e.code = "ETIMEOUT"; throw e; })).reason,
  "DNS_LOOKUP_FAILED"
);

console.log("PASS V2 CTD tracking-domain CNAME verify smoke");

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
    if (specifier.startsWith("@/")) return resolveAndLoad(resolve(rootDir, specifier.slice(2)));
    if (specifier.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), specifier));
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1));
  return require(base);
}
