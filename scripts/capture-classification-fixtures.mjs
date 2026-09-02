// Capture the page snapshots the classification accuracy test replays.
//
// Crawls every domain named in `CLASSIFICATION_GOLDEN` ONCE and writes the parsed page models to
// `lib/v2/company-intelligence/__fixtures__/classificationPages/<domain>.json`. After that the test
// runs offline and deterministically — which is the whole point: classification changes have shipped
// twice with no way to tell whether accuracy moved, because measuring meant hitting 100 live sites.
//
// Search results are captured too, not skipped. Snapshotting them keeps the fixture reproducible
// while still covering the sites that cannot be crawled at all — snyk.io answers OFFLINE and
// unilever.com answers BLOCKED, and those are exactly the companies that classify as NULL today. A
// fixture built from website text alone would quietly exclude the failure class it needs to measure.
// Pass --no-search to capture website evidence only.
//
//   node --env-file=.env scripts/capture-classification-fixtures.mjs                  # missing only
//   node --env-file=.env scripts/capture-classification-fixtures.mjs --concurrency 6
//   node --env-file=.env scripts/capture-classification-fixtures.mjs --force          # re-capture all
//   node --env-file=.env scripts/capture-classification-fixtures.mjs --only snyk.io,unilever.com
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

loadEnvFiles([".env.local", ".env"]);

const FORCE = process.argv.includes("--force");
const NO_SEARCH = process.argv.includes("--no-search");
const CONCURRENCY = readNumberFlag("--concurrency", 4);
const ONLY = readStringFlag("--only", null)?.split(",").map((d) => d.trim()).filter(Boolean) ?? null;

const { fetchCompanyMaterial } = loadTsModule("lib/v2/company-intelligence/runCompanyResearch.ts");
const { CLASSIFICATION_GOLDEN, CLASSIFICATION_FIXTURE_DIR } = loadTsModule(
  "lib/v2/company-intelligence/__fixtures__/classificationGolden.ts"
);

const outDir = resolve(rootDir, "lib/v2/company-intelligence/__fixtures__", CLASSIFICATION_FIXTURE_DIR);
mkdirSync(outDir, { recursive: true });

// A crawled page's text is already extracted (no markup), so this cap only trims pathological pages
// — a 200k-word terms-of-service dump would dominate the fixture without adding identity signal.
// Identity signal lives at the top of a page (title, hero, opening paragraphs), so a generous head
// is enough and keeps ~100 fixtures near 1 MB rather than 3 MB in the repo.
const MAX_TEXT_PER_PAGE = 12_000;

const targets = CLASSIFICATION_GOLDEN.filter((c) => {
  if (ONLY && !ONLY.includes(c.domain)) return false;
  if (FORCE) return true;
  return !existsSync(join(outDir, `${c.domain}.json`));
});

console.log(`golden cases:  ${CLASSIFICATION_GOLDEN.length}`);
console.log(`to capture:    ${targets.length}${FORCE ? " (--force)" : " (missing only)"}`);
console.log(`concurrency:   ${CONCURRENCY}`);
console.log(`out:           ${outDir}\n`);

if (targets.length === 0) {
  console.log("Nothing to capture.");
  process.exit(0);
}

const queue = [...targets];
const summary = [];

async function worker() {
  for (;;) {
    const target = queue.shift();
    if (!target) return;

    const started = Date.now();
    try {
      const fetched = await fetchCompanyMaterial({
        companyName: target.name,
        canonicalDomainInput: `https://${target.domain}`,
        websiteUrl: `https://${target.domain}`,
        disableSearch: NO_SEARCH,
        fetchOptions: { rateLimitIntervalMs: 0, timeoutMs: 15_000 },
      });

      // A domain that cannot be crawled is still recorded, with its status and zero pages. Silently
      // dropping it would quietly shrink the measured set and inflate accuracy.
      const material = fetched.ok ? fetched.material : null;
      const pages = (material?.pages ?? []).map((page) => ({
        url: page.url,
        path: page.path,
        pageType: page.pageType,
        title: page.title,
        metaDescription: page.metaDescription,
        ogTitle: page.ogTitle,
        ogDescription: page.ogDescription,
        h1: page.h1,
        h2s: page.h2s,
        jsonLdDescriptions: page.jsonLdDescriptions,
        mainText: (page.mainText ?? "").slice(0, MAX_TEXT_PER_PAGE),
      }));

      // `highlight` carries the body text for every provider (Exa highlights, Brave extra_snippets,
      // Serper snippet) and `snippet` is frequently null — Exa returns titles only. Capturing just
      // `snippet` reduced a five-result search to ~100 characters of evidence, which is why
      // search-only domains classified as nothing.
      const searchResults = (material?.search?.results ?? []).map((result) => ({
        url: result.url ?? null,
        title: result.title ?? null,
        snippet: result.snippet ?? null,
        highlight: result.highlight ?? null,
        provider: result.provider ?? null,
      }));

      const record = {
        domain: target.domain,
        name: target.name,
        status: material?.status ?? "NO_MATERIAL",
        capturedPages: pages.length,
        pagesWithText: pages.filter((p) => p.mainText.trim().length > 0).length,
        searchResultCount: searchResults.length,
        pages,
        searchResults,
      };

      writeFileSync(join(outDir, `${target.domain}.json`), JSON.stringify(record, null, 2), "utf8");
      summary.push({ domain: target.domain, status: record.status, pages: record.capturedPages, withText: record.pagesWithText, search: searchResults.length, ms: Date.now() - started });
      console.log(`${String(record.status).padEnd(20)} pages=${String(record.capturedPages).padEnd(3)} text=${String(record.pagesWithText).padEnd(3)} search=${String(searchResults.length).padEnd(3)} ${target.domain}`);
    } catch (error) {
      summary.push({ domain: target.domain, status: "ERROR", pages: 0, withText: 0, ms: Date.now() - started });
      console.log(`${"ERROR".padEnd(20)} ${target.domain}  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

// "No evidence at all" is the number that matters: a domain with neither page text nor search
// results cannot be classified by any taxonomy, so it belongs in a separate bucket rather than
// counting as a classifier failure.
const noEvidence = summary.filter((s) => s.withText === 0 && (s.search ?? 0) === 0);
const crawlFailedButSearched = summary.filter((s) => s.withText === 0 && (s.search ?? 0) > 0);
console.log("\n──────── SUMMARY ────────");
console.log(`captured:                 ${summary.length}`);
console.log(`crawl failed, search ok:  ${crawlFailedButSearched.length}  ${crawlFailedButSearched.map((s) => `${s.domain}(${s.status})`).join(", ")}`);
console.log(`no evidence at all:       ${noEvidence.length}  ${noEvidence.map((s) => `${s.domain}(${s.status})`).join(", ")}`);

// ── helpers ──────────────────────────────────────────────────────────────────

function readNumberFlag(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readStringFlag(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled
    .split("import.meta.url")
    .join(moduleUrl)
    .split("import.meta")
    .join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) {
      const aliasPath = resolve(rootDir, specifier.slice(2));
      const resolvedPath = existsSync(`${aliasPath}.ts`) ? `${aliasPath}.ts` : resolve(aliasPath, "index.ts");
      return loadTsModule(resolvedPath.slice(rootDir.length + 1));
    }
    if (!specifier.startsWith(".")) return require(specifier);
    const modulePath = resolve(dirname(absolutePath), specifier);
    const resolvedPath = existsSync(`${modulePath}.ts`) ? `${modulePath}.ts` : resolve(modulePath, "index.ts");
    return loadTsModule(resolvedPath.slice(rootDir.length + 1));
  };

  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    }
  }
}
