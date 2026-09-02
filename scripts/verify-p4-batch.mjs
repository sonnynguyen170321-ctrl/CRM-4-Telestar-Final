// LIVE verify of the tracked ENRICHMENT batch run. Requires Redis + a running bull
// worker. Creates a V2RuntimeRun(ENRICHMENT, total=N), enqueues N companies bound to it,
// and polls the run until processedUnits == totalUnits (exact X/N completion). Real crawl.
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();
loadEnvFiles([".env.local", ".env", ".env.production"]);

const { prisma } = loadTsModule("lib/server/prisma.ts");
const { createRuntimeRun } = loadTsModule("lib/v2/runtime/runtimeStore.ts");
const { enqueueEnrichmentExecution } = loadTsModule("lib/v2/company-intelligence/runtime/enqueueEnrichment.ts");
const { nextForcedResearchVersion } = loadTsModule("lib/v2/company-intelligence/pipelineVersion.ts");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const N = 3;

try {
  const pick = await pool.query(
    `SELECT c."id", c."organizationId"
       FROM "V2Company" c
       JOIN "V2LeadAssignment" la ON la."companyId"=c."id" AND la."status"='ACTIVE' AND la."deletedAt" IS NULL
      WHERE c."status"='ACTIVE' AND (c."canonicalDomain" IS NOT NULL OR c."websiteUrl" IS NOT NULL)
      GROUP BY c."id", c."organizationId" LIMIT ${N}`
  );
  if (pick.rows.length < 1) { console.log("NO eligible companies."); process.exit(2); }
  const organizationId = pick.rows[0].organizationId;
  const companyIds = pick.rows.map((r) => r.id);
  console.log(`batch: ${companyIds.length} companies, org=${organizationId}`);

  const runId = await createRuntimeRun({ organizationId, runType: "ENRICHMENT", totalUnits: companyIds.length, configJson: { companyIds } });
  console.log(`runId=${runId} totalUnits=${companyIds.length}`);

  for (const companyId of companyIds) {
    const m = await pool.query(`SELECT MAX("researchVersion")::int AS m FROM "V2CompanyIntelligenceProfile" WHERE "organizationId"=$1 AND "companyId"=$2`, [organizationId, companyId]);
    const researchVersion = nextForcedResearchVersion(m.rows[0]?.m ?? null);
    const d = await enqueueEnrichmentExecution(prisma, { organizationId, companyId, researchVersion, runtimeRunId: runId });
    if (d.mode !== "bull") { console.log("EXPECTED bull mode — got " + d.mode); process.exit(3); }
  }

  let last = "";
  for (let i = 0; i < 120; i++) {
    const r = await pool.query(`SELECT "status","processedUnits","succeededUnits","totalUnits" FROM "V2RuntimeRun" WHERE "id"=$1`, [runId]);
    const row = r.rows[0];
    const line = `[${i}s] run=${row.status} ${row.processedUnits}/${row.totalUnits} (ok=${row.succeededUnits})`;
    if (line !== last) { console.log(line); last = line; }
    if (["SUCCEEDED", "PARTIAL", "FAILED"].includes(row.status)) {
      console.log(row.status === "SUCCEEDED" ? "PASS P4 batch: run completed, every company enriched (exact X/N)." : `DONE status=${row.status}`);
      break;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
} finally {
  await pool.end();
  await prisma.$disconnect?.().catch(() => {});
}

function loadEnvFiles(names) {
  for (const n of names) { const p = resolve(rootDir, n); if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue; const i = t.indexOf("=");
      const k = t.slice(0, i).trim(); if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, ""); } }
}
function loadTsModule(rel) {
  const abs = isAbsolute(rel) ? rel : resolve(rootDir, rel);
  if (moduleCache.has(abs)) return moduleCache.get(abs).exports;
  const ts = require("typescript");
  const transpiled = ts.transpileModule(readFileSync(abs, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const url = JSON.stringify(pathToFileURL(abs).href);
  const output = transpiled.split("import.meta.url").join(url).split("import.meta").join(`({ url: ${url} })`);
  const mod = { exports: {} }; moduleCache.set(abs, mod);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s.startsWith("@/")) return loadTsModule(resolveTs(rootDir, s.slice(2)));
    if (!s.startsWith(".")) return require(s);
    return loadTsModule(resolveTs(dirname(abs), s));
  };
  new Function("require", "module", "exports", output)(localRequire, mod, mod.exports);
  return mod.exports;
}
function resolveTs(base, spec) {
  const p = resolve(base, spec);
  const c = [p, `${p}.ts`, `${p}.tsx`, resolve(p, "index.ts"), resolve(p, "index.tsx")].find((x) => { try { return statSync(x).isFile(); } catch { return false; } });
  if (!c) throw new Error(`unresolved ${spec} from ${base}`);
  return c;
}
