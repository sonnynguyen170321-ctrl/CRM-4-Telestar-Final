// Bulk re-enrichment after a classification-pipeline change.
//
// Why this exists: the de-biased taxonomy (non-tech categories + Vietnamese aliases) shipped
// WITHOUT bumping COMPANY_INTEL_PIPELINE_VERSION, so every enrichment re-run stayed idempotent
// against the old researchVersion and the new taxonomy never reached the database. Bumping the
// version makes re-enqueue meaningful again; this script drives it over a bounded batch and
// reports what actually changed, so the effect is measured rather than assumed.
//
// Enrichment writes a fresh V2CompanyIntelligenceProfile and enqueues the ICP_SCORE job that
// re-scores the company's lead assignments — so the score delta below is the real product effect.
//
//   node --env-file=.env scripts/reenrich-companies.mjs                    # dry-run, 50 companies
//   node --env-file=.env scripts/reenrich-companies.mjs --limit 200        # dry-run, wider
//   node --env-file=.env scripts/reenrich-companies.mjs --limit 50 --apply # enqueue + drain
//   node --env-file=.env scripts/reenrich-companies.mjs --limit 4000 --concurrency 8 --apply
//
// Selection favours companies that actually carry scored lead assignments, because a category
// change on a company nobody is working proves nothing about the product.
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
const LIMIT = readNumberFlag("--limit", 50);
const ORG = readStringFlag("--org", null);
// Parallel drain workers. Defaults to 1 so an unthinking run stays gentle on the crawl targets
// and on the search-provider quota; raise it for a bulk cutover.
const CONCURRENCY = readNumberFlag("--concurrency", 1);

const { enqueueCompanyEnrichmentJob } = loadTsModule("lib/v2/company-intelligence/index.ts");
const { currentResearchVersion } = loadTsModule("lib/v2/company-intelligence/pipelineVersion.ts");
const { claimNextV2Job, processV2Job } = loadTsModule("lib/v2/jobs/index.ts");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgDb(pool);
const researchVersion = currentResearchVersion();

// ── Select the batch ─────────────────────────────────────────────────────────

const organizationId = ORG ?? (await pickBusiestOrganization());
if (!organizationId) {
  console.error("No organization found. Pass --org <id>.");
  process.exit(1);
}

const targets = await pool.query(
  `SELECT c.id, c.name, c."canonicalDomain",
          c."industryCategory" AS category_before,
          (SELECT max(p."researchVersion") FROM "V2CompanyIntelligenceProfile" p
            WHERE p."companyId" = c.id) AS version_before,
          count(la.id) AS assignments,
          round(avg(a."fitScore")) AS avg_fit_before
     FROM "V2Company" c
     LEFT JOIN "V2LeadAssignment" la
            ON la."companyId" = c.id AND la."deletedAt" IS NULL
     LEFT JOIN "V2HardRuleAssessment" a
            ON a.id = la."latestHardRuleAssessmentId"
    WHERE c."organizationId" = $1
      AND c."deletedAt" IS NULL
    GROUP BY c.id, c.name, c."canonicalDomain"
    ORDER BY count(la.id) DESC, c."createdAt" DESC
    LIMIT $2`,
  [organizationId, LIMIT]
);

console.log(`organization:    ${organizationId}`);
console.log(`researchVersion: ${researchVersion} (target)`);
console.log(`companies:       ${targets.rows.length}`);
console.log(`mode:            ${APPLY ? "APPLY (enqueue + drain)" : "DRY-RUN"}\n`);

const stale = targets.rows.filter((r) => Number(r.version_before ?? 0) < researchVersion);
console.log(`already at target version: ${targets.rows.length - stale.length}`);
console.log(`to re-enrich:              ${stale.length}\n`);

console.table(
  targets.rows.slice(0, 20).map((r) => ({
    name: r.name.slice(0, 34),
    domain: r.canonicalDomain,
    category: r.category_before,
    v: r.version_before,
    leads: r.assignments,
    fit: r.avg_fit_before,
  }))
);

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to enqueue and drain.");
  await pool.end();
  process.exit(0);
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

let enqueued = 0;
let reused = 0;
for (const row of stale) {
  const result = await enqueueCompanyEnrichmentJob(db, {
    organizationId,
    companyId: row.id,
    researchVersion,
    createdByUserId: null,
  });
  // The enqueue is idempotent on (org, company, researchVersion); a reused job means this
  // company was already queued at this version, which is a no-op rather than a failure.
  if (result?.reused) reused += 1;
  else enqueued += 1;
}
console.log(`\nenqueued: ${enqueued}   reused: ${reused}`);

// ── Drain ────────────────────────────────────────────────────────────────────
// Scoped to the job types this script is responsible for. An unscoped `claimNextV2Job` claims
// whatever is due for the organization — including EMAIL_SEND — so a maintenance script would
// start executing real outreach as a side effect of re-enriching companies.

const DRAIN_JOB_TYPES = ["COMPANY_ENRICHMENT", "ICP_SCORE"];

let processed = 0;
let failed = 0;
const failures = [];

// Enrichment is network-bound (crawl + search + model call), roughly 16s of mostly-waiting per
// company, so a serial drain takes ~15h for the full estimate. `claimNextV2Job` claims under
// SELECT ... FOR UPDATE, so parallel workers cannot claim the same job.
async function drainWorker() {
  for (const jobType of DRAIN_JOB_TYPES) {
    for (;;) {
      const job = await claimNextV2Job(db, { organizationId, jobType });
      if (!job) break;

      const result = await processV2Job(db, job);
      processed += 1;
      if (result.kind !== "succeeded") {
        failed += 1;
        failures.push({ type: job.jobType, kind: result.kind, error: String(result.error ?? "").slice(0, 120) });
      }
      if (processed % 10 === 0) console.log(`  processed ${processed} jobs (${failed} failed)`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => drainWorker()));
console.log(`\ndrained: ${processed} jobs, ${failed} failed`);
if (failures.length) console.table(failures.slice(0, 15));

// ── Measure ──────────────────────────────────────────────────────────────────

const ids = stale.map((r) => r.id);
const after = await pool.query(
  `SELECT c.id, c.name,
          c."industryCategory" AS category_after,
          (SELECT max(p."researchVersion") FROM "V2CompanyIntelligenceProfile" p
            WHERE p."companyId" = c.id) AS version_after,
          round(avg(a."fitScore")) AS avg_fit_after
     FROM "V2Company" c
     LEFT JOIN "V2LeadAssignment" la
            ON la."companyId" = c.id AND la."deletedAt" IS NULL
     LEFT JOIN "V2HardRuleAssessment" a
            ON a.id = la."latestHardRuleAssessmentId"
    WHERE c.id = ANY($1)
    GROUP BY c.id, c.name`,
  [ids]
);

const beforeById = new Map(stale.map((r) => [r.id, r]));
const diff = after.rows.map((row) => {
  const before = beforeById.get(row.id) ?? {};
  return {
    name: row.name.slice(0, 30),
    category: `${before.category_before ?? "—"} → ${row.category_after ?? "—"}`,
    changed: (before.category_before ?? null) !== (row.category_after ?? null),
    v: `${before.version_before ?? "—"} → ${row.version_after ?? "—"}`,
    fit: `${before.avg_fit_before ?? "—"} → ${row.avg_fit_after ?? "—"}`,
  };
});

console.log("\n──────── CATEGORY / SCORE DIFF ────────");
console.table(diff);
console.log(`category changed: ${diff.filter((d) => d.changed).length}/${diff.length}`);

const outPath = resolve(rootDir, "reenrich-companies.report.json");
writeFileSync(outPath, JSON.stringify({ organizationId, researchVersion, diff }, null, 2), "utf8");
console.log(`report → ${outPath}`);

await pool.end();

// ── helpers ──────────────────────────────────────────────────────────────────

async function pickBusiestOrganization() {
  const res = await pool.query(
    `SELECT "organizationId", count(*) AS n FROM "V2Company"
      WHERE "deletedAt" IS NULL GROUP BY 1 ORDER BY n DESC LIMIT 1`
  );
  return res.rows[0]?.organizationId ?? null;
}

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
  // `new Function` is not a module, so any surviving `import.meta` is a syntax error. Substituting
  // the module's own file URL keeps modules that derive __dirname from it working.
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
