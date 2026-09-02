import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guard: ICP creation defaults to schema-v2. Every demo preset (the source for
// "Create from preset") must carry schema-v2 rules, so a freshly created ICP scores
// through the rules-v2 engine and shows the rules-v2 drawer. v1 stays only as
// read-compat for pre-existing assessments — this guard stops a silent regression
// back to a v1 default (the half-migrated state that hid the rules-v2 engine).
// Pure: no DB, no network.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { DEMO_ICP_PRESETS } = loadTsModule("lib/v2/scoring/demoIcpPresets.ts");
const { validateIcpVersionRulesV2 } = loadTsModule("lib/v2/scoring/rules/schema-v2.ts");

assert.ok(Array.isArray(DEMO_ICP_PRESETS) && DEMO_ICP_PRESETS.length > 0, "presets must exist");

for (const preset of DEMO_ICP_PRESETS) {
  assert.equal(
    preset.rulesJson?.schemaVersion,
    "v2",
    `preset ${preset.id} must default to schema-v2 (got ${preset.rulesJson?.schemaVersion})`
  );
  // must be a structurally valid v2 ruleset (so Create-from-preset persists cleanly)
  const parsed = validateIcpVersionRulesV2(preset.rulesJson);
  assert.equal(parsed.ruleSetId, preset.rulesJson.ruleSetId);
}

console.log(`PASS all ${DEMO_ICP_PRESETS.length} demo presets default to schema-v2`);
console.log("PASS Create-from-preset produces rules-v2 ICPs (v1 kept only for read-compat)");

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
