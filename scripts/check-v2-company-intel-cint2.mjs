// CINT2 mock-only smoke: query builder, providers (parse + status mapping),
// orchestrator fallback/stop, safeFetch SSRF. Injected fetch + DNS — no live API.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { buildCompanySearchQueries } = load("lib/v2/company-intelligence/search/buildCompanySearchQueries.ts");
const { ExaSearchProvider } = load("lib/v2/company-intelligence/search/providers/exaSearchProvider.ts");
const { BraveSearchProvider } = load("lib/v2/company-intelligence/search/providers/braveSearchProvider.ts");
const { SerperSearchProvider } = load("lib/v2/company-intelligence/search/providers/serperSearchProvider.ts");
const { runQueryAcrossProviders } = load("lib/v2/company-intelligence/search/companyIntelSearch.ts");
const { safeFetch } = load("lib/v2/company-intelligence/safeFetch.ts");

function res(status, body, headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => "", headers: { get: (k) => h[k.toLowerCase()] ?? null } };
}

// --- query builder ---
{
  const qs = buildCompanySearchQueries({ companyName: "Acme", canonicalDomain: "acme.com", country: "US" });
  assert.ok(qs.length >= 2 && qs.length <= 6);
  assert.equal(qs[0].purpose, "company_profile");
  assert.ok(qs.every((q) => q.query.includes('"Acme"')));
  assert.deepEqual(buildCompanySearchQueries({ companyName: "" }), []);
}

// --- providers parse + status mapping ---
{
  const exa = new ExaSearchProvider("k", async () => res(200, { results: [{ title: "Acme", url: "https://acme.com/", highlights: ["Acme builds SMS for Shopify"], publishedDate: "2024" }] }));
  const o = await exa.search({ query: "x", resultsPerQuery: 5, timeoutMs: 1000 });
  assert.equal(o.results.length, 1);
  assert.equal(o.results[0].highlight, "Acme builds SMS for Shopify");
  assert.equal(o.results[0].sourceDomain, "acme.com");
  assert.equal(o.attempt.status, "ok");

  const brave = new BraveSearchProvider("k", async () => res(200, { web: { results: [{ title: "T", url: "https://x.io/a", description: "desc", extra_snippets: ["snip"] }] } }));
  const ob = await brave.search({ query: "x", resultsPerQuery: 5, timeoutMs: 1000 });
  assert.equal(ob.results[0].snippet, "desc");
  assert.equal(ob.results[0].highlight, "snip");

  const serper = new SerperSearchProvider("k", async () => res(200, { organic: [{ title: "T", link: "https://y.io/b", snippet: "s", position: 3 }] }));
  const os = await serper.search({ query: "x", resultsPerQuery: 5, timeoutMs: 1000 });
  assert.equal(os.results[0].url, "https://y.io/b");
  assert.equal(os.results[0].position, 3);

  const rl = new ExaSearchProvider("k", async () => res(429, {}));
  const orl = await rl.search({ query: "x", resultsPerQuery: 5, timeoutMs: 1000 });
  assert.equal(orl.attempt.status, "http_error");
  assert.equal(orl.attempt.rejectionReason, "rate_limited");
}

// --- orchestrator: fallback on noise, stop on sufficient ---
function mockProvider(name, results) {
  return {
    provider: name,
    async search() {
      return { attempt: { provider: name, status: "ok", httpStatus: 200, latencyMs: 1, resultCount: results.length, usableCount: 0, evidenceScore: 0, rejectionReason: null }, results };
    },
  };
}
const officialResults = [
  { provider: "x", title: "Acme", url: "https://acme.com/", snippet: null, highlight: "x".repeat(50), publishedDate: null, position: 1, sourceDomain: "acme.com" },
  { provider: "x", title: "About", url: "https://acme.com/about", snippet: null, highlight: null, publishedDate: null, position: 2, sourceDomain: "acme.com" },
];
const noiseResults = [
  { provider: "x", title: "FB", url: "https://facebook.com/acme", snippet: "s", highlight: null, publishedDate: null, position: 1, sourceDomain: "facebook.com" },
];
const deps = { timeoutMs: 1000, resultsPerQuery: 5, minUsableResults: 2, maxProviderAttemptsPerQuery: 3 };
{
  const r = await runQueryAcrossProviders(
    { query: "q", purpose: "company_profile", canonicalDomain: "acme.com" },
    { ...deps, providers: [mockProvider("brave", noiseResults), mockProvider("serper", officialResults)] }
  );
  assert.equal(r.providerUsed, "serper");
  assert.deepEqual(r.attemptedProviders, ["brave", "serper"]);
  assert.equal(r.attempts[0].rejectionReason, "mostly_noise");
  assert.equal(r.sufficiency.sufficient, true);
}
{
  const r = await runQueryAcrossProviders(
    { query: "q", purpose: "company_profile", canonicalDomain: "acme.com" },
    { ...deps, providers: [mockProvider("exa", officialResults), mockProvider("brave", noiseResults)] }
  );
  assert.equal(r.providerUsed, "exa");
  assert.equal(r.attempts.length, 1, "stops at first sufficient provider");
}

// --- safeFetch SSRF ---
{
  // blocked: host resolves to private IP
  const r1 = await safeFetch("https://evil.com/", {}, { fetchImpl: async () => res(200, {}), lookup: async () => "10.0.0.1" });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "BLOCKED_RESOLVED_IP");

  // blocked: redirect to localhost (validated before following)
  let calls = 0;
  const r2 = await safeFetch("https://good.com/", {}, {
    fetchImpl: async () => { calls++; return res(302, {}, { location: "http://localhost/admin" }); },
    lookup: async (h) => (h === "good.com" ? "93.184.216.34" : "127.0.0.1"),
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "BLOCKED_HOST");

  // allowed: public host, 200
  const r3 = await safeFetch("https://example.com/", {}, { fetchImpl: async () => res(200, {}), lookup: async () => "93.184.216.34" });
  assert.equal(r3.ok, true);
  assert.equal(r3.status, 200);
}

console.log("PASS V2 company-intel CINT2 smoke (queries + providers + orchestrator + safeFetch)");

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
