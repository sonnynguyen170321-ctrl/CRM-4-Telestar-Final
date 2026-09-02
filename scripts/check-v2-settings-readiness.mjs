import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// R7 smoke: provider/transport readiness reports configured-ness (booleans only,
// no secret values). Pure.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { buildProviderReadiness } = loadTsModule("lib/v2/settings/buildProviderReadiness.ts");

// fully configured + a live sender + kill switch off -> outreach ready
const ready = buildProviderReadiness({
  hasOutreachCredentialKey: true, hasWorkerSecret: true, killSwitchEngaged: false,
  searchProviderConfigured: true, aiEnabled: true,
  senderCounts: { total: 2, liveEnabled: 1, relays: 1, mailboxes: 1 },
});
assert.equal(ready.outreach.status, "ready");
assert.equal(ready.outreach.liveSendReady, true);
assert.equal(ready.enrichment.searchProvider, "ready");
assert.equal(ready.ai.status, "ready");

// kill switch engaged -> blocked regardless
const blocked = buildProviderReadiness({ hasOutreachCredentialKey: true, hasWorkerSecret: true, killSwitchEngaged: true, searchProviderConfigured: false, aiEnabled: false, senderCounts: { total: 2, liveEnabled: 1, relays: 1, mailboxes: 1 } });
assert.equal(blocked.outreach.status, "blocked");
assert.equal(blocked.outreach.liveSendReady, false, "kill switch blocks live send");
assert.ok(blocked.outreach.notes.some((n) => n.includes("Kill switch")));

// nothing configured -> not_configured + actionable notes
const none = buildProviderReadiness({ hasOutreachCredentialKey: false, hasWorkerSecret: false, killSwitchEngaged: false, searchProviderConfigured: false, aiEnabled: false, senderCounts: { total: 0, liveEnabled: 0, relays: 0, mailboxes: 0 } });
assert.equal(none.outreach.status, "not_configured");
assert.ok(none.outreach.notes.length >= 3, "actionable setup notes");

// no secret values appear anywhere in the readiness output
assert.ok(!/V2_OUTREACH_CREDENTIAL_KEY\s*[:=]\s*\S/.test(JSON.stringify(none)), "no secret values, only booleans");
console.log("PASS R7 readiness (ready/blocked/not_configured; no secret values)");
console.log("PASS V2 settings provider readiness (R7)");

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
