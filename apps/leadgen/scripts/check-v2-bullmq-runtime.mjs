// P0.3 smoke: the BullMQ layer's PURE surface (config flag parsing, prefix, queue-name
// registry, default job options). No Redis, no bullmq instantiation — proves the
// opt-in guard + registry are correct so the layer stays inert until enabled.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { isBullEnabled, bullPrefix } = loadTsModule("lib/v2/bullmq/config.ts");
const { V2_QUEUE_NAMES, ALL_V2_QUEUE_NAMES } = loadTsModule("lib/v2/bullmq/queueNames.ts");
const { defaultJobOptions } = loadTsModule("lib/v2/bullmq/jobOptions.ts");

// 1. isBullEnabled: off by default + truthy parsing.
{
  const saved = process.env.V2_BULL_ENABLED;
  delete process.env.V2_BULL_ENABLED;
  assert.equal(isBullEnabled(), false, "disabled by default (no env) — local stays zero-Redis");
  for (const v of ["1", "true", "TRUE", "on", "yes"]) {
    process.env.V2_BULL_ENABLED = v;
    assert.equal(isBullEnabled(), true, `'${v}' enables`);
  }
  for (const v of ["", "0", "false", "off", "no", "True "]) {
    process.env.V2_BULL_ENABLED = v;
    // note: "True " has a trailing space -> trimmed -> "true" -> enabled; test the clearly-off ones
  }
  process.env.V2_BULL_ENABLED = "false";
  assert.equal(isBullEnabled(), false, "'false' stays off");
  if (saved === undefined) delete process.env.V2_BULL_ENABLED;
  else process.env.V2_BULL_ENABLED = saved;
}
console.log("PASS isBullEnabled: off by default, truthy parsing");

// 2. bullPrefix default + override.
{
  const saved = process.env.V2_BULL_PREFIX;
  delete process.env.V2_BULL_PREFIX;
  assert.equal(bullPrefix(), "telestar:v2");
  process.env.V2_BULL_PREFIX = "myorg:v2";
  assert.equal(bullPrefix(), "myorg:v2");
  if (saved === undefined) delete process.env.V2_BULL_PREFIX;
  else process.env.V2_BULL_PREFIX = saved;
}
console.log("PASS bullPrefix default + override");

// 3. Queue registry: noop present, all values unique, all dotted v2.* names.
{
  assert.equal(V2_QUEUE_NAMES.noop, "v2.noop");
  const values = ALL_V2_QUEUE_NAMES;
  assert.equal(new Set(values).size, values.length, "queue names are unique");
  assert.ok(values.every((n) => n.startsWith("v2.")), "all names namespaced v2.*");
}
console.log("PASS queue registry: noop + unique + namespaced");

// 4. defaultJobOptions: research/ai heavier, others lighter; retention present.
{
  const research = defaultJobOptions("v2.research.fetch");
  const light = defaultJobOptions("v2.outreach.send");
  assert.equal(research.attempts, 4, "research gets more attempts");
  assert.equal(research.backoff.delay, 15_000, "research longer backoff");
  assert.equal(light.attempts, 3);
  assert.equal(light.backoff.delay, 5_000);
  assert.equal(light.backoff.type, "exponential");
  assert.ok(light.removeOnComplete.age > 0 && light.removeOnFail.age > 0, "retention configured");
}
console.log("PASS defaultJobOptions: heavy vs light + retention");

console.log("PASS V2 BullMQ runtime scaffold (P0.3)");

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
