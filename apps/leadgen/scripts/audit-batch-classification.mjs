// Live sweep: run the REAL company-intelligence runtime (crawl → reasoning → taxonomy) over the
// FieldPro Track A batch domains and report the classification each gets, so remaining bugs surface
// (misclassification, fetch failures, VN-language pages, JS-render/blocked sites). Live crawl, search
// disabled (no keys needed). Transpile-on-load, no DB. Usage: node scripts/audit-batch-classification.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { runCompanyResearch } = load("lib/v2/company-intelligence/runCompanyResearch.ts");
const { classifyServedVerticals } = load("lib/v2/scoring/rules/dictionaries/servedVertical.ts");
const { CATEGORY_PREFERRED_SECTORS } = load("lib/v2/company-intelligence/presentIntelligence.ts");

const TECH_IDS = new Set([
  "ecommerce_saas", "customer_intel", "crm_martech", "data_analytics", "ai_automation", "cybersecurity",
  "hr_recruiting", "fintech", "education", "healthtech", "b2b_saas", "devtools", "fintech_payments",
  "fintech_lending", "legaltech", "proptech", "hardware_iot", "marketplace", "msp", "hospitality_travel",
]);

// Representative real domains from the batch, tagged with the (often wrong) CSV/LinkedIn industry.
const COMPANIES = [
  // "Machinery"-labelled but actually food/beverage — the headline de-bias proof
  { name: "Bich Chi Food", domain: "bichchi.com.vn", industry: "Machinery" },
  { name: "LOF (Dutch Lady)", domain: "lof.vn", industry: "Machinery" },
  { name: "Orion Vietnam", domain: "orion.vn", industry: "Machinery" },
  { name: "Nestle Vietnam", domain: "nestle.com.vn", industry: "Machinery" },
  { name: "Thien Huong Food", domain: "thienhuongfood.com", industry: "Machinery" },
  { name: "Vinatea", domain: "vinatea.com.vn", industry: "Machinery" },
  { name: "Richy Group", domain: "richy.com.vn", industry: "Machinery" },
  // Dairy
  { name: "Vinamilk", domain: "vinamilk.com.vn", industry: "Food & Beverages" },
  { name: "Nutricare", domain: "nutricare.com.vn", industry: "Dairy" },
  { name: "VitaDairy", domain: "vitadairy.vn", industry: "Dairy" },
  { name: "TH Group", domain: "thmilk.vn", industry: "Food & Beverages" },
  // Beer / wine & spirits
  { name: "Heineken Vietnam", domain: "heineken-vietnam.com.vn", industry: "Food & Beverages" },
  { name: "Sabeco", domain: "sabeco.com.vn", industry: "Food & Beverages" },
  { name: "Habeco", domain: "habeco.com.vn", industry: "Wine & Spirits" },
  { name: "Carlsberg Vietnam", domain: "carlsbergvietnam.vn", industry: "Food & Beverages" },
  { name: "Sapporo Vietnam", domain: "sapporovietnam.com.vn", industry: "Food & Beverages" },
  // Coffee
  { name: "Trung Nguyen Legend", domain: "trungnguyenlegend.com", industry: "Food & Beverages" },
  { name: "Highlands Coffee", domain: "highlandscoffee.com.vn", industry: "Food & Beverages" },
  { name: "TNI King Coffee", domain: "kingcoffee.com", industry: "Food & Beverages" },
  { name: "Vinacafe", domain: "vinacafebienhoa.com", industry: "Consumer Goods" },
  // Confectionery / snacks
  { name: "Bibica", domain: "bibica.com.vn", industry: "Food & Beverages" },
  { name: "Hai Ha", domain: "haihaco.com.vn", industry: "Food Production" },
  { name: "Perfetti Van Melle", domain: "perfettivanmelle.com", industry: "Consumer Goods" },
  { name: "Mondelez", domain: "mondelezinternational.com", industry: "Food Production" },
  // F&B misc
  { name: "Masan Consumer", domain: "masanconsumer.com", industry: "Food & Beverages" },
  { name: "Nutifood", domain: "nutifood.com.vn", industry: "Food & Beverages" },
  { name: "Vifon", domain: "vifon.com.vn", industry: "Food & Beverages" },
  { name: "Acecook Vietnam", domain: "acecookvietnam.vn", industry: "Consumer Goods" },
  { name: "Betrimex", domain: "betrimex.com.vn", industry: "Food & Beverages" },
  { name: "Cholimex Food", domain: "cholimexfood.com.vn", industry: "Food & Beverages" },
  { name: "URC Vietnam", domain: "urc.com.vn", industry: "Food & Beverages" },
  { name: "Suntory PepsiCo", domain: "suntorypepsico.vn", industry: "Food & Beverages" },
  // Import & export / agriculture
  { name: "Phuc Sinh", domain: "phucsinh.com", industry: "Import & Export" },
  { name: "Luong Quoi Coconut", domain: "luongquoi.vn", industry: "Food & Beverages" },
  // Retail
  { name: "Yakult Vietnam", domain: "yakult.vn", industry: "Retail" },
];

const limit = Number(process.argv[2] || COMPANIES.length);
const rows = [];

for (const c of COMPANIES.slice(0, limit)) {
  const started = Date.now();
  try {
    const res = await runCompanyResearch({
      companyName: c.name,
      country: "Vietnam",
      industryRaw: c.industry,
      canonicalDomainInput: `https://${c.domain}`,
      websiteUrl: `https://${c.domain}`,
      disableSearch: true,
      fetchOptions: { rateLimitIntervalMs: 0, timeoutMs: 12000 },
    });
    const facts = res.profile.factsJson;
    const catTok = facts.find((f) => f.startsWith("category."));
    const category = catTok ? catTok.slice("category.".length) : null;
    const reasoning = res.profile.classificationJson.reasoning;
    const offering = reasoning?.offering?.value?.type ?? null;
    const confidence = reasoning?.overallConfidence ?? null;
    const pagesWithContent = res.profile.sourceCoverageJson.pagesWithContent ?? 0;
    const verticalText = [res.profile.companySummary, ...facts].filter(Boolean).join(" ");
    // Same tie-break the product uses (presentIntelligence): without the category's preferred
    // sectors, a food producer whose site says "nhà máy / factory" reads as INDUSTRIAL and the
    // two axes disagree — which made this audit look like a classification bug that isn't one.
    const verticals = classifyServedVerticals(
      verticalText,
      3,
      category ? CATEGORY_PREFERRED_SECTORS[category] ?? [] : []
    ).map((v) => v.label);
    const techMisfire = category != null && TECH_IDS.has(category);
    rows.push({
      name: c.name, csvIndustry: c.industry, status: res.status, pagesWithContent,
      category, vertical: verticals[0] ?? null, offering, confidence, techMisfire,
      ms: Date.now() - started,
    });
  } catch (e) {
    rows.push({ name: c.name, csvIndustry: c.industry, status: "ERROR", error: String(e?.message ?? e), ms: Date.now() - started });
  }
  const r = rows[rows.length - 1];
  console.log(
    `${(r.status || "").padEnd(18)} ${String(r.category ?? "—").padEnd(22)} ${String(r.vertical ?? "—").padEnd(22)} pwc=${r.pagesWithContent ?? "-"} ${r.techMisfire ? "⚠TECH" : ""}  ${r.name}${r.error ? "  ERR:" + r.error : ""}`
  );
}

// ── Summary ──
const done = rows.filter((r) => r.status !== "ERROR");
const reached = rows.filter((r) => r.category != null);
const techMis = rows.filter((r) => r.techMisfire);
const failed = rows.filter((r) => r.status === "ERROR" || r.status === "FAILED" || (r.pagesWithContent ?? 0) === 0);

console.log("\n──────── SUMMARY ────────");
console.log(`companies:            ${rows.length}`);
console.log(`classified (category): ${reached.length}`);
console.log(`unknown (no category): ${rows.length - reached.length}`);
console.log(`⚠ tech misfires:       ${techMis.length}  ${techMis.map((r) => r.name + "→" + r.category).join(", ")}`);
console.log(`no usable content:     ${failed.length}  ${failed.map((r) => r.name + "(" + r.status + ")").join(", ")}`);

const outPath = resolve(rootDir, "audit-batch-classification.report.json");
writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf8");
console.log(`\nreport → ${outPath}`);

// ── transpile-on-load (from check-v2-company-intel-cint3.mjs), server-only stubbed ──
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
