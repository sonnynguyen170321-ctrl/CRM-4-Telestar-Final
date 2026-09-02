// Re-score EXISTING lead assignments after the rules or the company evidence behind them changed.
//
// Two things make old assessments wrong without anything in the queue noticing:
//   - the classification pipeline changed (fixed by `scripts/reenrich-companies.mjs`), or
//   - the ICP rules were repaired (fixed by `scripts/repair-icp-persona.mjs`).
// Neither re-scores anything on its own for assignments that were already scored, so this drives
// the ICP_SCORE job over every (project, icpVersion) pair that owns assignments.
//
// Nothing is overwritten: scoring inserts a NEW immutable assessment and moves
// `latestHardRuleAssessmentId` (Invariant 4). An assignment whose inputs and rules are unchanged
// keeps its existing assessment, because the fingerprint matches — so re-running is inert.
//
//   node --env-file=.env scripts/rescore-icp.mjs                       # dry-run
//   node --env-file=.env scripts/rescore-icp.mjs --apply               # enqueue + drain
//   node --env-file=.env scripts/rescore-icp.mjs --icp <id> --apply    # one ICP version only
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

loadEnvFiles([".env.local", ".env", ".env.production"]);

const APPLY = process.argv.includes("--apply");
const ONLY_ICP = readStringFlag("--icp", null);

const { enqueueIcpScoreJob } = loadTsModule("lib/v2/scoring/runtime/enqueueScoringJobs.ts");
const { claimNextV2Job, processV2Job } = loadTsModule("lib/v2/jobs/index.ts");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgDb(pool);

const pairs = await pool.query(
  `SELECT la."organizationId", la."projectId", la."icpVersionId", p.name AS icp_name,
          count(*) AS assignments,
          count(a.id) AS scored,
          round(avg(a."fitScore")) AS avg_fit_before,
          count(DISTINCT a."fitScore") AS distinct_fit_before
     FROM "V2LeadAssignment" la
     JOIN "V2ICPVersion" v ON v.id = la."icpVersionId"
     JOIN "V2ICPProfile" p ON p.id = v."icpProfileId"
     LEFT JOIN "V2HardRuleAssessment" a ON a.id = la."latestHardRuleAssessmentId"
    WHERE la."deletedAt" IS NULL
      AND la."projectId" IS NOT NULL
      AND ($1::text IS NULL OR la."icpVersionId" = $1)
    GROUP BY la."organizationId", la."projectId", la."icpVersionId", p.name
    ORDER BY count(*) DESC`,
  [ONLY_ICP]
);

console.log(`(project, icpVersion) pairs: ${pairs.rows.length}`);
console.log(`assignments in scope:        ${pairs.rows.reduce((sum, r) => sum + Number(r.assignments), 0)}`);
console.log(`mode:                        ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

console.table(
  pairs.rows.slice(0, 25).map((r) => ({
    icp: r.icp_name.slice(0, 34),
    assignments: r.assignments,
    scored: r.scored,
    avg_fit: r.avg_fit_before,
    distinct_fit: r.distinct_fit_before,
  }))
);

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to enqueue and drain.");
  await pool.end();
  process.exit(0);
}

let enqueued = 0;
for (const row of pairs.rows) {
  await enqueueIcpScoreJob(db, {
    organizationId: row.organizationId,
    selection: {
      kind: "project_icp",
      projectId: row.projectId,
      icpVersionId: row.icpVersionId,
    },
    createdByUserId: null,
  });
  enqueued += 1;
}
console.log(`\nenqueued: ${enqueued} ICP_SCORE jobs`);

const organizations = [...new Set(pairs.rows.map((r) => r.organizationId))];
let processed = 0;
let failed = 0;
const failures = [];
for (const organizationId of organizations) {
  for (;;) {
    const job = await claimNextV2Job(db, { organizationId, jobType: "ICP_SCORE" });
    if (!job) break;

    const result = await processV2Job(db, job);
    processed += 1;
    if (result.kind !== "succeeded") {
      failed += 1;
      failures.push({ kind: result.kind, error: String(result.error ?? "").slice(0, 140) });
    }
    if (processed % 5 === 0) console.log(`  processed ${processed} score jobs (${failed} failed)`);
  }
}
console.log(`\ndrained: ${processed} jobs, ${failed} failed`);
if (failures.length) console.table(failures.slice(0, 15));

// ── Measure ──────────────────────────────────────────────────────────────────

const after = await pool.query(
  `SELECT count(*) AS assignments,
          count(DISTINCT a."fitScore") AS distinct_fit,
          round(avg(a."fitScore")) AS avg_fit,
          count(*) FILTER (WHERE a."fitScore" BETWEEN 50 AND 59) AS in_50s
     FROM "V2LeadAssignment" la
     JOIN "V2HardRuleAssessment" a ON a.id = la."latestHardRuleAssessmentId"
    WHERE la."deletedAt" IS NULL
      AND ($1::text IS NULL OR la."icpVersionId" = $1)`,
  [ONLY_ICP]
);
const dist = await pool.query(
  `SELECT a."qualification", count(*) AS n
     FROM "V2LeadAssignment" la
     JOIN "V2HardRuleAssessment" a ON a.id = la."latestHardRuleAssessmentId"
    WHERE la."deletedAt" IS NULL
      AND ($1::text IS NULL OR la."icpVersionId" = $1)
    GROUP BY 1 ORDER BY n DESC`,
  [ONLY_ICP]
);

console.log("\n──────── AFTER ────────");
console.table(after.rows);
console.table(dist.rows);

const outPath = resolve(rootDir, "rescore-icp.report.json");
writeFileSync(outPath, JSON.stringify({ before: pairs.rows, after: after.rows, qualification: dist.rows }, null, 2), "utf8");
console.log(`report → ${outPath}`);

await pool.end();

// ── helpers ──────────────────────────────────────────────────────────────────

function readStringFlag(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function createPgDb(poolOrClient) {
  return {
    async $queryRaw(strings, ...values) {
      const query = buildParameterizedQuery(strings, values);
      const result = await poolOrClient.query(query.text, query.values);
      return result.rows;
    },
    async $executeRaw(strings, ...values) {
      const query = buildParameterizedQuery(strings, values);
      const result = await poolOrClient.query(query.text, query.values);
      return result.rowCount ?? 0;
    },
    async $queryRawUnsafe(text, ...values) {
      const result = await poolOrClient.query(text, values);
      return result.rows;
    },
    async $executeRawUnsafe(text, ...values) {
      const result = await poolOrClient.query(text, values);
      return result.rowCount ?? 0;
    },
    async $transaction(callback) {
      const client = await poolOrClient.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(createPgDb(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function buildParameterizedQuery(strings, values) {
  let text = "";
  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];
    if (index < values.length) text += `$${index + 1}`;
  }
  return { text, values };
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
