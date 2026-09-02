// One-shot LIVE verify of the R3 BullMQ scoring fan-out. Requires Redis + a running
// bull worker (npm run v2:worker). Picks a real project+ICP with a few active leads,
// plans a scoring run, dispatches via BullMQ, and polls the V2RuntimeRun/Chunk mirror
// until terminal. Read-mostly (it does score real leads — idempotent/reused if already
// scored). NOT a committed smoke; a manual E2E probe.
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
const { createScoringRun } = loadTsModule("lib/v2/scoring/runtime/createScoringRun.ts");
const { enqueueScoringExecution } = loadTsModule("lib/v2/scoring/runtime/enqueueScoringExecution.ts");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const sel = await pool.query(
    `SELECT "organizationId","projectId","icpVersionId", COUNT(*)::int AS n
       FROM "V2LeadAssignment"
      WHERE "status"='ACTIVE' AND "deletedAt" IS NULL AND "projectId" IS NOT NULL AND "icpVersionId" IS NOT NULL
      GROUP BY 1,2,3 HAVING COUNT(*) BETWEEN 1 AND 80
      ORDER BY n DESC LIMIT 1`
  );
  if (!sel.rows[0]) { console.log("NO eligible project+ICP with 1-80 active leads — cannot verify."); process.exit(2); }
  const { organizationId, projectId, icpVersionId, n } = sel.rows[0];
  console.log(`selection: org=${organizationId} project=${projectId} icp=${icpVersionId} leads=${n}`);

  const run = await createScoringRun(prisma, {
    organizationId, selection: { kind: "project_icp", projectId, icpVersionId },
    projectId, icpVersionId, batchSize: 10,
  });
  console.log(`run ${run.runId}: total=${run.total} chunks=${run.chunkCount} batchSize=${run.batchSize}`);

  const dispatch = await enqueueScoringExecution(prisma, { organizationId, run });
  console.log(`dispatch mode: ${dispatch.mode}`);
  if (dispatch.mode !== "bull") { console.log("EXPECTED bull mode (V2_BULL_ENABLED) — got " + dispatch.mode); process.exit(3); }

  let last = "";
  for (let i = 0; i < 90; i++) {
    const r = await pool.query(`SELECT "status","processedUnits","succeededUnits","failedUnits" FROM "V2RuntimeRun" WHERE "id"=$1`, [run.runId]);
    const c = await pool.query(
      `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE "status"='SUCCEEDED')::int ok,
              COUNT(*) FILTER (WHERE "status"='QUEUED')::int q, COUNT(*) FILTER (WHERE "status"='RUNNING')::int run,
              COUNT(*) FILTER (WHERE "status"='FAILED')::int fail
         FROM "V2RuntimeChunk" WHERE "runId"=$1`, [run.runId]);
    const rr = r.rows[0], cc = c.rows[0];
    const line = `[${i}s] run=${rr.status} proc=${rr.processedUnits} | chunks ok=${cc.ok} run=${cc.run} q=${cc.q} fail=${cc.fail}/${cc.total}`;
    if (line !== last) { console.log(line); last = line; }
    if (["SUCCEEDED", "PARTIAL", "FAILED"].includes(rr.status) && Number(cc.q) === 0 && Number(cc.run) === 0) {
      console.log(rr.status === "SUCCEEDED" ? "PASS R3 live: bull fan-out scored all chunks." : `DONE with status ${rr.status}.`);
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
