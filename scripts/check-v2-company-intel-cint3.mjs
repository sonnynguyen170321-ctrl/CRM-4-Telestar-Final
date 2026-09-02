// CINT3 mock-only smoke: page model extraction + golden reasoning fixtures
// (Royal Cargo / Predicti / Postscript / unknown). Pure, no LLM, no network.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { extractPageModel } = load("lib/v2/company-intelligence/reasoning/pageModel.ts");
const { compileCompanyIntelligence } = load("lib/v2/company-intelligence/reasoning/compile.ts");

// --- page model extraction ---
{
  const html = `<html><head><title>Acme</title>
    <meta name="description" content="Acme builds X">
    <meta property="og:title" content="Acme OG">
    <script type="application/ld+json">{"description":"LD desc"}</script>
    </head><body><h1>Hero</h1><h2>Feature</h2><p>body text here</p></body></html>`;
  const m = extractPageModel({ url: "https://acme.com/about", html });
  assert.equal(m.title, "Acme");
  assert.equal(m.metaDescription, "Acme builds X");
  assert.equal(m.h1, "Hero");
  assert.deepEqual(m.h2s, ["Feature"]);
  assert.deepEqual(m.jsonLdDescriptions, ["LD desc"]);
  assert.equal(m.pageType, "ABOUT");
}

const page = (over) => ({ url: "https://x.com/", pageType: "HOMEPAGE", title: null, metaDescription: null, headings: [], mainText: "", ...over });

// --- Royal Cargo (logistics) ---
{
  const { reasoning, brief, controlledTokens } = await compileCompanyIntelligence({
    companyName: "Royal Cargo Inc", canonicalDomain: "royalcargo.com", country: "PH",
    pages: [
      page({ url: "https://royalcargo.com/", pageType: "HOMEPAGE", metaDescription: "Royal Cargo Inc — freight forwarding, warehousing, and project logistics across Asia.", headings: ["Freight forwarding & logistics"], mainText: "cargo transport warehousing customs brokerage 3pl supply chain shipping" }),
      page({ url: "https://royalcargo.com/about", pageType: "ABOUT", metaDescription: "40+ years of cargo transport and customs brokerage", headings: ["About"], mainText: "freight forwarding project logistics warehousing" }),
    ],
    searchResults: [],
  });
  assert.equal(reasoning.offering.value.type, "service", "logistics => service offering");
  assert.ok(controlledTokens.includes("category.logistics"), "has logistics token");
  assert.match(brief, /logistics|freight/i);
  assert.notEqual(reasoning.overallConfidence, "LOW");
}

// --- Predicti (customer intelligence) ---
{
  const { reasoning, brief, controlledTokens } = await compileCompanyIntelligence({
    companyName: "Predicti", canonicalDomain: "predicti.com", country: null,
    pages: [
      page({ url: "https://predicti.com/", pageType: "HOMEPAGE", metaDescription: "Predicti is a customer intelligence and personalization platform for marketing and CRM teams.", headings: ["Customer intelligence platform"], mainText: "customer data segmentation insights audience engagement for businesses" }),
    ],
    searchResults: [],
  });
  assert.equal(reasoning.offering.value.type, "saas");
  assert.ok(controlledTokens.includes("category.customer_intel"), "has customer_intel token");
  assert.ok(controlledTokens.includes("model.b2b"));
  assert.match(brief, /customer intelligence|personalization|provides/i);
}

// --- Postscript (vertical SaaS for ecommerce) ---
{
  const { reasoning, brief, controlledTokens } = await compileCompanyIntelligence({
    companyName: "Postscript", canonicalDomain: "postscript.io", country: "US",
    pages: [
      page({ url: "https://postscript.io/", pageType: "HOMEPAGE", metaDescription: "SMS marketing platform built for Shopify ecommerce DTC brands.", headings: ["SMS for Shopify"], mainText: "sms campaigns automations shopify ecommerce merchants subscription available on the shopify app store for businesses" }),
      page({ url: "https://postscript.io/partners", pageType: "PARTNERS", metaDescription: "Integrations with Klaviyo, Recharge, Gorgias", headings: ["Partners"], mainText: "partners integrations Klaviyo Recharge Gorgias" }),
    ],
    searchResults: [
      { url: "https://techcrunch.com/postscript", text: "Postscript raised $35M Series B funding and is hiring engineers and sales", pageType: "SEARCH", provider: "exa" },
    ],
  });
  assert.equal(reasoning.offering.value.type, "vertical_saas");
  assert.equal(reasoning.offering.value.vertical, "ecommerce");
  assert.ok(controlledTokens.includes("vertical.ecommerce"));
  assert.ok(controlledTokens.includes("offering.vertical_saas"));
  assert.ok(controlledTokens.includes("growth.funding"), "funding signal");
  assert.equal(reasoning.growth.hiring.value.real, true);
  assert.ok(reasoning.channels.value.includes("marketplace"), "shopify app store => marketplace");
  assert.match(brief, /ecommerce/i);
}

// --- unknown / no evidence ---
{
  const { reasoning, brief } = await compileCompanyIntelligence({
    companyName: "Ghost Co", canonicalDomain: null, country: null,
    pages: [page({ url: "https://ghost.co/", mainText: "x" })],
    searchResults: [],
  });
  assert.equal(reasoning.offering.value.type, "unknown");
  assert.equal(reasoning.overallConfidence, "LOW");
  assert.match(brief, /insufficient/i);
}

console.log("PASS V2 company-intel CINT3 smoke (pageModel + golden reasoning fixtures)");

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
