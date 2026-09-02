// P0.1 smoke: the jsonb/text sanitizer must remove the characters Postgres rejects
// (U+0000 + other control chars + lone surrogates) and NFC-normalize, so scraped/email/
// CSV text persists instead of failing the insert. Pure — no DB.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { sanitizeText, sanitizeJsonbValue, toJsonbParam, sanitizeNullableText } = loadTsModule(
  "lib/v2/persistence/jsonbSanitizer.ts"
);

const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7); // C0 control
const DEL = String.fromCharCode(127); // DEL
const LONE_HIGH = String.fromCharCode(0xd800); // lone high surrogate
const EMOJI = String.fromCodePoint(0x1f680); // 🚀 — a valid surrogate pair

// 1. Strips NUL + control chars + DEL + lone surrogate; keeps tab/newline/CR + emoji.
{
  const dirty = `a${NUL}b${BELL}c${DEL}d${LONE_HIGH}e\t\n\r${EMOJI}`;
  const clean = sanitizeText(dirty);
  assert.equal(clean.includes(NUL), false, "removes NUL");
  assert.equal(clean.includes(BELL), false, "removes C0 control");
  assert.equal(clean.includes(DEL), false, "removes DEL");
  assert.equal(clean.includes(LONE_HIGH), false, "removes lone surrogate");
  assert.equal(clean.includes("\t") && clean.includes("\n") && clean.includes("\r"), true, "keeps tab/newline/CR");
  assert.equal(clean.includes(EMOJI), true, "keeps a valid surrogate pair (emoji)");
  assert.equal(clean.startsWith("abcde"), true, `letters preserved in order, got: ${JSON.stringify(clean)}`);
}
console.log("PASS sanitizeText strips illegal chars, keeps tab/newline/CR + emoji");

// 2. NFC normalization (Invariant 11): decomposed -> composed.
{
  const decomposed = "Cong ty Cỏ Phần"; // combining marks (Vietnamese-ish)
  const out = sanitizeText(decomposed);
  assert.equal(out, out.normalize("NFC"), "output is NFC");
  assert.equal(out.normalize("NFD") !== out, true, "input had decomposable marks");
}
console.log("PASS sanitizeText NFC-normalizes");

// 3. The critical jsonb case: toJsonbParam must NOT emit a \\u0000 escape (Postgres jsonb
//    rejects it) and must stay valid JSON.
{
  const param = toJsonbParam({ note: `hi${NUL}there`, nested: [`x${BELL}y`, { k: `${NUL}` }] });
  assert.equal(param.includes("\\u0000"), false, "no \\u0000 escape in jsonb param");
  const parsed = JSON.parse(param);
  assert.equal(parsed.note, "hithere", "null byte removed inside object value");
  assert.equal(parsed.nested[0], "xy");
  assert.equal(parsed.nested[1].k, "");
}
console.log("PASS toJsonbParam removes NUL so ::jsonb cast cannot fail");

// 4. Deep clean covers object KEYS too; passthrough for non-strings.
{
  const cleaned = sanitizeJsonbValue({ [`bad${NUL}key`]: 1, ok: [true, null, 3.5, `v${NUL}`] });
  const keys = Object.keys(cleaned);
  assert.equal(keys.includes("badkey"), true, "object key sanitized");
  assert.deepEqual(cleaned.ok, [true, null, 3.5, "v"], "non-strings pass through; string cleaned");
}
console.log("PASS sanitizeJsonbValue cleans keys + recurses, passes non-strings");

// 5. Nullable helper passes null/undefined through.
{
  assert.equal(sanitizeNullableText(null), null);
  assert.equal(sanitizeNullableText(undefined), undefined);
  assert.equal(sanitizeNullableText(`a${NUL}`), "a");
}
console.log("PASS sanitizeNullableText tolerates null/undefined");

console.log("PASS V2 jsonb sanitize (P0.1)");

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
