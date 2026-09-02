// Qualification audit: run real batch leads through the REAL v2 scoring engine (assessIcpRulesV2)
// and print the qualification + reason-code distribution, so "zero qualified" can be attributed to a
// specific cause. Scores each lead twice:
//   THIN     = today's reality (company enrichment sparse: industry/size/website unknown)
//   ENRICHED = what the same lead looks like once enrichment resolves industry + size + website
// The delta isolates "evidence starvation" from "thresholds too harsh".
// Pure: no DB, no network. Usage: node scripts/audit-batch-qualification.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { assessIcpRulesV2 } = load("lib/v2/scoring/rules/deriveQualification.ts");
const corpus = load("lib/v2/scoring/__fixtures__/icpCorpus/index.ts");

const ICP = corpus.DPOINT; // Vietnam · RETAIL/FNB/FMCG · marketing/CX/CEO personas — closest to this batch

// Real leads from the FieldPro Track A batch (company + the contact actually uploaded).
const LEADS = [
  { company: "Masan Consumer", domain: "masanconsumer.com", industry: "Food & Beverages", employees: 750, title: "Trade Marketing Manager", email: "hoang.y@msc.masangroup.com" },
  { company: "Heineken Vietnam", domain: "heineken-vietnam.com.vn", industry: "Food & Beverages", employees: 3000, title: "Sales Director", email: "nguyen.vu@heineken.com" },
  { company: "Nutifood", domain: "nutifood.com.vn", industry: "Food & Beverages", employees: 750, title: "Trade Marketing Manager", email: "phut@nutifood.com.vn" },
  { company: "Orion Vietnam", domain: "orion.vn", industry: "Machinery", employees: 120, title: "Sales Manager", email: "trang.bui@orionworld.com" },
  { company: "TH Group", domain: "thmilk.vn", industry: "Food & Beverages", employees: 120, title: "IT Director", email: "hphien@thmilk.vn" },
  { company: "Highlands Coffee", domain: "highlandscoffee.com.vn", industry: "Food & Beverages", employees: 750, title: "Head of Trade Marketing & eCommerce", email: "chau.ly@vtijs.com" },
  { company: "Suntory PepsiCo", domain: "suntorypepsico.vn", industry: "Food & Beverages", employees: 3000, title: "Director of Information Technology", email: "lamquoc.dat@suntorypepsico.vn" },
  { company: "Trung Nguyen Legend", domain: "trungnguyenlegend.com", industry: "Food & Beverages", employees: 350, title: "Trade Marketing Supervisor", email: "toan.tran@trungnguyenlegend.com" },
  { company: "Sabeco", domain: "sabeco.com.vn", industry: "Food & Beverages", employees: 350, title: "Managing Director", email: "nguyen.g@sabeco.com.vn" },
  { company: "Uniben", domain: "unibenfoods.com", industry: "Food & Beverages", employees: 120, title: "Chief Executive Officer", email: "anh.nguyen@unibenfoods.com" },
  { company: "Vinamilk", domain: "vinamilk.com.vn", industry: "Food & Beverages", employees: 3000, title: "Sales Director", email: "sinhhong@vinamilk.com.vn" },
];

const FOOD_TEXT =
  "thực phẩm và đồ uống, sữa, bánh kẹo, nước giải khát — nhà phân phối bán lẻ toàn quốc. " +
  "Food and beverage producer, packaged food and consumer goods for retail and modern trade.";

/** THIN: what the engine sees today when VN enrichment yields little (industry/size/website unknown). */
function thinEvidence(lead) {
  return {
    company: { companyName: lead.company, domain: lead.domain, country: "Vietnam", evidenceText: "" },
    ...(lead.title ? { contact: { rawTitle: lead.title, email: lead.email } } : {}),
  };
}

/** ENRICHED: same lead once enrichment resolves industry + size + website. */
function enrichedEvidence(lead) {
  return {
    company: {
      companyName: lead.company,
      domain: lead.domain,
      country: "Vietnam",
      industry: lead.industry,
      industryTags: ["FNB", "Food & Beverage", "FMCG", "retail"],
      employeeCount: lead.employees,
      websiteStatus: "reachable",
      description: `${lead.company} — food & beverage producer in Vietnam.`,
      evidenceText: FOOD_TEXT,
      productSignals: ["packaged food", "beverage"],
      serviceSignals: [],
    },
    ...(lead.title ? { contact: { rawTitle: lead.title, email: lead.email } } : {}),
  };
}

// Recommended persona tuning: model buyer proximity with titleTiers instead of widening titleKeywords
// to a flat 70. Tiers are evaluated before titleKeywords and first-match-wins, so listing marketing
// first keeps the primary persona strictly above sales/IT influencers.
const TUNED_ICP = {
  ...ICP,
  persona: {
    ...ICP.persona,
    titleTiers: [
      { tier: 1, weight: 70, titles: [], keywords: ["marketing", "trade marketing", "customer experience", "customer success", "crm", "loyalty", "omnichannel", "channel", "partnerships", "alliances", "ceo", "cmo"] },
      { tier: 2, weight: 55, titles: [], keywords: ["sales", "commercial", "business development", "revenue"] },
      { tier: 3, weight: 45, titles: [], keywords: ["information technology", "digital transformation", "cio", "cto"] },
    ],
  },
};

function run(label, build, icp = ICP) {
  const rows = LEADS.map((lead) => {
    const r = assessIcpRulesV2(build(lead), icp);
    return {
      company: lead.company,
      title: lead.title,
      qualification: r.qualification,
      fit: r.fitScore,
      confidence: r.confidenceScore,
      preRank: r.accountPreRank,
      missing: r.dataQuality?.missingEvidence ?? r.missingEvidence ?? [],
      required: r.requiredEvidenceMissing ?? [],
      reasons: r.reasonCodes ?? [],
    };
  });

  console.log(`\n════════ ${label} ════════`);
  for (const r of rows) {
    console.log(
      `${r.qualification.padEnd(32)} fit=${String(r.fit).padStart(3)} conf=${String(r.confidence).padStart(3)} ${r.preRank ?? ""}`.padEnd(78) +
      `${r.company} — ${r.title}`
    );
    if (r.required.length) console.log(`      required-missing: ${r.required.join(", ")}`);
    if (r.missing.length) console.log(`      missing-evidence: ${r.missing.join(", ")}`);
    if (r.reasons.length) console.log(`      reasons: ${r.reasons.join(", ")}`);
  }

  const dist = {};
  for (const r of rows) dist[r.qualification] = (dist[r.qualification] ?? 0) + 1;
  console.log(`\n  distribution: ${JSON.stringify(dist)}`);
  return rows;
}

console.log(`ICP: ${ICP.displayName ?? ICP.ruleSetId}`);
console.log(`thresholds: qualifiedMinFit=${ICP.scorePolicy?.qualifiedMinFitScore} needsReviewMinFit=${ICP.scorePolicy?.needsReviewMinFitScore} highConfidence=${ICP.confidencePolicy?.highConfidenceThreshold}`);
console.log(`persona weight=${ICP.scoringWeights?.persona} | requiredEvidence=${JSON.stringify(ICP.requiredEvidenceForFinalQualification)}`);
console.log(`requirePersonaForFinalQualification=${ICP.persona?.requirePersonaForFinalQualification} blocksCompanyOnly=${ICP.blocksFinalQualificationFromCompanyOnlyEvidence}`);

const thin = run("THIN evidence (today: VN enrichment sparse)", thinEvidence);
const enriched = run("ENRICHED evidence (industry + size + website resolved)", enrichedEvidence);
const tuned = run("ENRICHED + persona titleTiers (recommended ICP tuning)", enrichedEvidence, TUNED_ICP);

const delta = (from, to, label) => {
  const lifted = to.filter((t, i) => t.qualification !== from[i].qualification);
  console.log(`\n──────── DELTA: ${label} ────────`);
  console.log(`leads whose outcome changes: ${lifted.length}/${LEADS.length}`);
  for (const l of lifted) {
    const b = from.find((x) => x.company === l.company);
    console.log(`  ${l.company} (${l.title}): ${b.qualification} → ${l.qualification} (fit ${b.fit}→${l.fit})`);
  }
};
delta(thin, enriched, "enrichment alone");
delta(enriched, tuned, "persona titleTiers on top of enrichment");

writeFileSync(resolve(rootDir, "audit-batch-qualification.report.json"), JSON.stringify({ thin, enriched, tuned }, null, 2), "utf8");
console.log(`\nreport → audit-batch-qualification.report.json`);

// ── transpile-on-load (server-only stubbed) ──
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
