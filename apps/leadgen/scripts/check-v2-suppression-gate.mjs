import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O2 smoke: the suppression gate is the single, un-bypassable chokepoint before any
// send (Invariant 10, design B5). Pure: no DB (candidates are injected), no network.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { normalizeEmailIdentifier, extractDomainIdentifier } = loadTsModule(
  "lib/v2/outreach/suppression/normalizeIdentifier.ts"
);
const { decideSuppression, redactEmail } = loadTsModule(
  "lib/v2/outreach/suppression/decideSuppression.ts"
);
const { assertNotSuppressed, isGatePassToken, SuppressedError } = loadTsModule(
  "lib/v2/outreach/suppression/assertNotSuppressed.ts"
);

// 1. Normalize
assert.equal(normalizeEmailIdentifier("  Jane.Doe@Example.COM "), "jane.doe@example.com");
assert.equal(normalizeEmailIdentifier("not-an-email"), null);
assert.equal(extractDomainIdentifier("a@Foo.io"), "foo.io");
assert.equal(redactEmail("jane@acme.com"), "j***@acme.com");
console.log("PASS normalize + redact");

// 2. Pure decision
const row = (over) => ({
  id: "s1",
  identifierType: "EMAIL",
  identifierValueNormalized: "jane@acme.com",
  suppressionType: "MANUAL",
  deletedAt: null,
  expiresAt: null,
  ...over,
});
assert.ok(decideSuppression([row()], { email: "jane@acme.com" }), "exact email blocks");
assert.equal(decideSuppression([row()], { email: "other@acme.com" }), null, "non-match passes");
assert.ok(
  decideSuppression([row({ identifierType: "DOMAIN", identifierValueNormalized: "acme.com" })], { email: "anyone@acme.com" }),
  "domain blocks"
);
assert.equal(
  decideSuppression([row({ expiresAt: new Date(Date.now() - 1000) })], { email: "jane@acme.com" }),
  null,
  "expired entry does not block"
);
assert.equal(
  decideSuppression([row({ deletedAt: new Date() })], { email: "jane@acme.com" }),
  null,
  "soft-deleted entry does not block"
);
for (const type of ["UNSUBSCRIBE", "BOUNCE", "BLACKLIST", "TENANT_LEVEL"]) {
  assert.ok(decideSuppression([row({ suppressionType: type })], { email: "jane@acme.com" }), `${type} blocks`);
}
console.log("PASS pure decision (email/domain/expired/soft-deleted/all suppression types)");

// 3. The gate: throws on suppressed, mints a GatePassToken otherwise
const loadHit = async () => [row()];
const loadClean = async () => [];

await assert.rejects(
  () => assertNotSuppressed({ organizationId: "org1", email: "jane@acme.com", loadCandidates: loadHit, onBlocked: () => {} }),
  (err) => err instanceof SuppressedError && err.code === "SUPPRESSED" && err.toAddressRedacted === "j***@acme.com"
);
await assert.rejects(
  () => assertNotSuppressed({ organizationId: "org1", email: null, loadCandidates: loadClean, onBlocked: () => {} }),
  (err) => err instanceof SuppressedError,
  "missing address is itself a block (never send to nothing)"
);
const token = await assertNotSuppressed({ organizationId: "org1", email: "ok@good.com", loadCandidates: loadClean });
assert.ok(isGatePassToken(token), "clean email mints a valid GatePassToken");
assert.equal(token.organizationId, "org1");

// 4. Un-bypassable: a forged token object is NOT a valid GatePassToken (only the
//    gate can mint one via the module-private brand symbol). The provider boundary
//    (O3) requires isGatePassToken, so no path reaches SMTP without the gate.
assert.equal(isGatePassToken({ organizationId: "org1", checkedAt: new Date() }), false, "forged token rejected");
assert.equal(isGatePassToken(null), false);
console.log("PASS gate throws on suppressed/no-address, mints token on clean, forged token rejected");

// 5. The block sink never logs a full email (redacted only)
let captured = null;
const loadDomainHit = async () => [row({ identifierType: "DOMAIN", identifierValueNormalized: "acme.com" })];
await assertNotSuppressed({ organizationId: "org1", email: "secret.person@acme.com", loadCandidates: loadDomainHit, onBlocked: (e) => { captured = e; } }).catch(() => {});
assert.ok(captured && captured.toAddressRedacted === "s***@acme.com" && !JSON.stringify(captured).includes("secret.person"), "block event redacts the email");
console.log("PASS suppression block is logged redacted (no full email / Invariant 9)");
console.log("PASS V2 suppression gate (O2)");

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
