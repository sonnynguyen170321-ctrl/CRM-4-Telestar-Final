// One-shot LIVE verify of the P4 BullMQ enrichment split. Requires Redis + a running
// bull worker. Picks a real company (with a domain + active leads), forces a fresh
// research version, dispatches research.discover, and polls until the pipeline
// (discover -> fetch -> extract) persists a V2CompanyIntelligenceProfile + clears the
// staging row. Does real web crawling. Manual probe, not CI.
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
const { enqueueEnrichmentExecution } = loadTsModule("lib/v2/company-intelligence/runtime/enqueueEnrichment.ts");
const { nextForcedResearchVersion } = loadTsModule("lib/v2/company-intelligence/pipelineVersion.ts");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const pick = await pool.query(
    `SELECT c."id", c."organizationId", c."name"
       FROM "V2Company" c
       JOIN "V2LeadAssignment" la ON la."companyId"=c."id" AND la."status"='ACTIVE' AND la."deletedAt" IS NULL
      WHERE c."status"='ACTIVE' AND (c."canonicalDomain" IS NOT NULL OR c."websiteUrl" IS NOT NULL)
      GROUP BY c."id", c."organizationId", c."name" LIMIT 1`
  );
  if (!pick.rows[0]) { console.log("NO eligible company (domain + active leads) — cannot verify."); process.exit(2); }
  const { id: companyId, organizationId, name } = pick.rows[0];
  const maxRow = await pool.query(`SELECT MAX("researchVersion")::int AS m FROM "V2CompanyIntelligenceProfile" WHERE "organizationId"=$1 AND "companyId"=$2`, [organizationId, companyId]);
  const researchVersion = nextForcedResearchVersion(maxRow.rows[0]?.m ?? null);
  console.log(`company: ${name} (${companyId}) org=${organizationId} -> researchVersion=${researchVersion}`);

  const dispatch = await enqueueEnrichmentExecution(prisma, { organizationId, companyId, researchVersion });
  console.log(`dispatch mode: ${dispatch.mode}`);
  if (dispatch.mode !== "bull") { console.log("EXPECTED bull mode — got " + dispatch.mode); process.exit(3); }

  let last = "";
  for (let i = 0; i < 120; i++) {
    const prof = await pool.query(`SELECT "profileStatus" FROM "V2CompanyIntelligenceProfile" WHERE "organizationId"=$1 AND "companyId"=$2 AND "researchVersion"=$3 LIMIT 1`, [organizationId, companyId, researchVersion]);
    const stg = await pool.query(`SELECT COUNT(*)::int n FROM "V2CompanyResearchStaging" WHERE "organizationId"=$1 AND "companyId"=$2 AND "researchVersion"=$3`, [organizationId, companyId, researchVersion]);
    const status = prof.rows[0]?.profileStatus ?? "(pending)";
    const line = `[${i}s] profile=${status} staging=${stg.rows[0].n}`;
    if (line !== last) { console.log(line); last = line; }
    if (prof.rows[0]) {
      console.log(`PASS P4 live: enrichment split persisted a profile (status=${status}); staging cleared=${stg.rows[0].n === 0}.`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
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
