// CINT1 mock-only smoke: SSRF guard, search usability/sufficiency, env parser,
// confidence link, pipeline versioning. Pure — no live API, no DB.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { COMPANY_INTEL_PIPELINE_VERSION, nextForcedResearchVersion } = load("lib/v2/company-intelligence/pipelineVersion.ts");
const { assertSafePublicUrl, isBlockedHost, isPrivateIpv4 } = load("lib/v2/company-intelligence/urlSafety.ts");
const { scoreSearchResult, scoreSearchResults, computeSufficiency } = load("lib/v2/company-intelligence/search/scoreSearchResult.ts");
const { readCompanyIntelSearchConfig, resolveUsableProviderChain } = load("lib/v2/company-intelligence/search/env.ts");
const { deriveIntelConfidenceSignal } = load("lib/v2/company-intelligence/reasoning/confidenceLink.ts");

// --- pipeline versioning ---
assert.equal(COMPANY_INTEL_PIPELINE_VERSION, 2);
assert.equal(nextForcedResearchVersion(1), 3);
assert.equal(nextForcedResearchVersion(null), 3);
assert.equal(nextForcedResearchVersion(5), 6);

// --- SSRF guard ---
for (const bad of [
  "http://localhost/x", "http://127.0.0.1", "http://169.254.169.254/latest/meta-data",
  "http://10.0.0.1", "http://192.168.1.1", "http://172.16.0.1", "http://[::1]/",
  "ftp://example.com", "https://user:pass@example.com", "http://intranet",
  "http://foo.local", "http://metadata.google.internal",
]) {
  assert.equal(assertSafePublicUrl(bad).ok, false, `should block ${bad}`);
}
assert.equal(assertSafePublicUrl("https://www.example.com/about").ok, true);
assert.equal(assertSafePublicUrl("https://acme.co.uk").ok, true);
assert.equal(isBlockedHost("foo.local"), true);
assert.equal(isBlockedHost("example.com"), false);
assert.equal(isPrivateIpv4("8.8.8.8"), false);
assert.equal(isPrivateIpv4("10.1.2.3"), true);

// --- search usability + sufficiency ---
const mk = (over) => ({ provider: "exa", title: "t", url: "https://x.com/p", snippet: null, highlight: null, publishedDate: null, position: 1, sourceDomain: null, ...over });
// official homepage + meaningful highlight = 4 + 1
{
  const s = scoreSearchResult(mk({ url: "https://acme.com/", highlight: "Acme builds an SMS platform for Shopify ecommerce brands worldwide." }), { canonicalDomain: "acme.com" });
  assert.equal(s.isOfficialDomain, true);
  assert.equal(s.score, 5);
  assert.equal(s.usable, true);
}
// official about page = 4 + 2
{
  const s = scoreSearchResult(mk({ url: "https://acme.com/about" }), { canonicalDomain: "acme.com" });
  assert.equal(s.score, 6);
}
// social = reject
{
  const s = scoreSearchResult(mk({ url: "https://facebook.com/acme", sourceDomain: "facebook.com" }));
  assert.equal(s.usable, false);
  assert.equal(s.rejectReason, "social_or_directory_noise");
}
// sufficiency: 2 usable + score>=5
{
  const scored = scoreSearchResults([
    mk({ url: "https://acme.com/", highlight: "x".repeat(50) }),
    mk({ url: "https://acme.com/about" }),
  ], { canonicalDomain: "acme.com" });
  const suf = computeSufficiency(scored, 2);
  assert.equal(suf.sufficient, true);
  assert.ok(suf.totalScore >= 5);
}
// not sufficient: 1 weak result
{
  const scored = scoreSearchResults([mk({ url: "https://other.com/blog/post", highlight: "x".repeat(50) })], { canonicalDomain: "acme.com" });
  const suf = computeSufficiency(scored, 2);
  assert.equal(suf.sufficient, false);
}

// --- env parser (mock env, no real keys) ---
{
  const cfg = readCompanyIntelSearchConfig({
    COMPANY_INTEL_SEARCH_ENABLED: "true",
    COMPANY_INTEL_SEARCH_PROVIDER_CHAIN: "brave,exa",
    EXA_API_KEY: "k1", SERPER_API_KEY: "", BRAVE_SEARCH_API_KEY: "k2",
    COMPANY_INTEL_SEARCH_TIMEOUT_MS: "5000",
  });
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.providerChain, ["brave", "exa"]);
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(cfg.configuredProviders.exa, true);
  assert.equal(cfg.configuredProviders.serper, false);
  // usable chain = configured order intersected with keys present
  const chain = resolveUsableProviderChain({
    COMPANY_INTEL_SEARCH_ENABLED: "true",
    COMPANY_INTEL_SEARCH_PROVIDER_CHAIN: "exa,brave,serper",
    EXA_API_KEY: "k", BRAVE_SEARCH_API_KEY: "", SERPER_API_KEY: "k",
  });
  assert.deepEqual(chain, ["exa", "serper"]);
  // disabled => empty
  assert.deepEqual(resolveUsableProviderChain({ COMPANY_INTEL_SEARCH_ENABLED: "false", EXA_API_KEY: "k" }), []);
}

// --- confidence link ---
{
  const high = deriveIntelConfidenceSignal({
    overallConfidence: "HIGH",
    evidenceQuality: { pagesFetched: 6, usefulPages: 5, uniqueSources: 4, score: 11, conflicts: [] },
  });
  assert.equal(high.band, "HIGH");
  assert.ok(high.evidenceConfidence >= 0.75);
  const none = deriveIntelConfidenceSignal({
    overallConfidence: "LOW",
    evidenceQuality: { pagesFetched: 0, usefulPages: 0, uniqueSources: 0, score: 0, conflicts: [] },
  });
  assert.equal(none.hasUsableEvidence, false);
  assert.equal(none.band, "LOW");
}

console.log("PASS V2 company-intel CINT1 smoke (ssrf + usability + env + confidence + versioning)");

function load(relativePath) {
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
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return load(c.slice(rootDir.length + 1));
  return require(base);
}
