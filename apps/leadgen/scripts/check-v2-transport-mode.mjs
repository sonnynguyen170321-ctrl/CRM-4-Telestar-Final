// W4 smoke: the transport-mode display must mirror the runtime gates exactly — kill
// switch and a missing credential key force sandbox; a gated sender is sandbox; only an
// enabled sender with the key and no kill switch is live. Pure.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { resolveTransportMode } = loadTsModule("lib/v2/outreach/send/transportMode.ts");

const live = { senderLiveSendEnabled: true, killSwitchEngaged: false, credentialKeyPresent: true };

assert.equal(resolveTransportMode(live).mode, "live", "enabled + key + no kill = live");
assert.equal(resolveTransportMode({ ...live, killSwitchEngaged: true }).mode, "sandbox", "kill switch -> sandbox");
assert.equal(resolveTransportMode({ ...live, credentialKeyPresent: false }).mode, "sandbox", "no key -> sandbox");
assert.equal(resolveTransportMode({ ...live, senderLiveSendEnabled: false }).mode, "sandbox", "gated sender -> sandbox");
console.log("PASS transport mode mirrors the three gates");

// kill switch wins even if everything else is set.
assert.match(resolveTransportMode({ senderLiveSendEnabled: true, killSwitchEngaged: true, credentialKeyPresent: true }).reason, /kill switch/i);
// missing key reason is specific.
assert.match(resolveTransportMode({ ...live, credentialKeyPresent: false }).reason, /CREDENTIAL_KEY/);
console.log("PASS reasons are specific + ordered (kill switch first)");

console.log("PASS V2 transport mode (W4)");

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
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return loadTsModule(candidate.slice(rootDir.length + 1));
  }
  return require(base);
}
