// W1 smoke: the LeadAssignment-centered route contract builds stable, correct links.
// Pure - no DB, no Next.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const R = loadTsModule("lib/v2/crm/leadRoutes.ts");

assert.equal(R.leadDrawerHref("la_1"), "/v2/workspace/leads?selectedLeadId=la_1");
assert.equal(R.companyLeadsHref("co_1"), "/v2/workspace/leads?companyId=co_1");
assert.equal(R.companyDrawerHref("co_1"), "/v2/crm/companies?companyId=co_1");
assert.equal(R.composeHref("la_1"), "/v2/outreach/compose?leadAssignmentId=la_1");
assert.equal(R.inboxThreadHref("la_1"), "/v2/outreach/inbox/la_1");
assert.equal(R.contactDrawerHref("ct_1"), "/v2/crm/contacts?contactId=ct_1");
console.log("PASS single-id route builders");

// campaign from selection: ids joined by comma under source=selected
assert.equal(
  R.newCampaignFromSelectionHref(["a", "b", "c"]),
  "/v2/outreach/campaigns/new?source=selected&leadIds=a%2Cb%2Cc"
);
assert.equal(R.parseLeadIdsParam("a,b,c").join("|"), "a|b|c");
assert.deepEqual(R.parseLeadIdsParam(" a , ,b "), ["a", "b"], "trims + drops empties");
assert.deepEqual(R.parseLeadIdsParam(null), []);
console.log("PASS campaign-from-selection round-trips through parseLeadIdsParam");

// campaign from filter: only set fields appear
{
  const href = R.newCampaignFromFilterHref({ projectId: "p_1", icpVersionId: "icp_1", qualification: "QUALIFIED" });
  assert.ok(href.startsWith("/v2/outreach/campaigns/new?source=filter"));
  assert.ok(href.includes("projectId=p_1") && href.includes("icpVersionId=icp_1") && href.includes("qualification=QUALIFIED"));
  assert.ok(!href.includes("ownerUserId"), "unset fields are omitted");
}
console.log("PASS campaign-from-filter omits unset fields");

console.log("PASS V2 lead route contract (W1)");

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
