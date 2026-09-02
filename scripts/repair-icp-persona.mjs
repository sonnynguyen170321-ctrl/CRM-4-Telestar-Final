// Repair ICP versions published with NO persona constraint at all.
//
// `personaScore` gives a flat 60 to every contact holding any title when an ICP authors no
// titleAllowlist, no titleTiers and no titleKeywords (dimensions/personaScore.ts, the
// `!hasPositiveConstraint` branch). Persona is one of the heaviest dimensions, so an unauthored
// persona turns it into a constant and the dimension stops separating leads — visible in
// production as thousands of assignments sharing a handful of fit scores.
//
// This fills ONLY that case with the same decision-maker ladder the ICP templates ship
// (`execTiers`): CEO/founder 100, C-level 95, VP/head/director 80, manager/lead 55. An ICP that
// authored any persona constraint on purpose is left alone — this repairs blanks, it does not
// override intent.
//
// It repairs the published version IN PLACE via `saveIcpDraftRules`, which explicitly accepts
// `status = 'PUBLISHED'`. That is deliberate: `V2LeadAssignment` is pinned to the icpVersionId
// chosen at upload time, so publishing a NEW version would only ever affect future uploads and
// would leave every existing assignment scored against the blank persona. Editing the version the
// assignments already point at is what lets `scripts/rescore-icp.mjs` fix the existing data.
//
// Assessment history is not lost: every assessment snapshots the rules it was scored with, and
// re-scoring inserts a new immutable assessment rather than overwriting the old one (Invariant 4).
//
//   node --env-file=.env scripts/repair-icp-persona.mjs            # dry-run
//   node --env-file=.env scripts/repair-icp-persona.mjs --apply    # edit in place
//   then: node --env-file=.env scripts/rescore-icp.mjs --apply     # re-score existing assignments
import { existsSync, readFileSync } from "node:fs";
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
// Only profiles that carry real work. Smoke/demo ICPs exist in the same table and publishing a
// version for them is noise, not a fix.
const MIN_ASSIGNMENTS = readNumberFlag("--min-assignments", 50);

const { execTiers } = loadTsModule("lib/v2/scoring/rules/icpTemplatesV2.ts");
const { saveIcpDraftRules, upgradeSourceRulesToV2 } = loadTsModule("lib/v2/icp/authoring.ts");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgDb(pool);

// Only the LATEST published version of each profile matters: uploads bind to the version chosen
// at the time, and nobody selects a superseded one. Repairing v3 while v8 exists just adds rows.
// `profileAssignments` counts across every version of the profile, because a profile's importance
// is its total work, not how much landed on its newest version.
const versions = await pool.query(
  `
  SELECT DISTINCT ON (v."icpProfileId")
         v.id, v."organizationId", v."icpProfileId", v."versionNumber", v."version", p.name, v."rulesJson",
         (SELECT count(*) FROM "V2LeadAssignment" la
            JOIN "V2ICPVersion" pv ON pv.id = la."icpVersionId"
           WHERE pv."icpProfileId" = v."icpProfileId" AND la."deletedAt" IS NULL) AS profile_assignments
    FROM "V2ICPVersion" v
    JOIN "V2ICPProfile" p ON p.id = v."icpProfileId"
   WHERE v.status = 'PUBLISHED' AND v."deletedAt" IS NULL
   ORDER BY v."icpProfileId", v."versionNumber" DESC`
);

const blankAll = versions.rows.filter((row) => !hasPositivePersona(row.rulesJson));
const blank = blankAll.filter((row) => Number(row.profile_assignments) >= MIN_ASSIGNMENTS);
const skipped = blankAll.filter((row) => Number(row.profile_assignments) < MIN_ASSIGNMENTS);

console.log(`profiles (latest published): ${versions.rows.length}`);
console.log(`with no persona at all:      ${blankAll.length}`);
console.log(`below --min-assignments=${MIN_ASSIGNMENTS}:   ${skipped.length} (skipped, listed below)`);
console.log(`to repair:                   ${blank.length}`);
console.log(`mode:                        ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

const describe = (row) => ({
  icp: row.name.slice(0, 38),
  latest_v: row.versionNumber,
  profile_leads: row.profile_assignments,
  persona: describePersona(row.rulesJson),
});

console.table(blank.map(describe));
if (skipped.length) {
  console.log("skipped (too little work to justify a new version):");
  console.table(skipped.map(describe));
}

if (!blank.length) {
  console.log("Nothing to repair.");
  await pool.end();
  process.exit(0);
}

if (!APPLY) {
  console.log("\nWould add the exec ladder to each of the above:");
  console.log(JSON.stringify(execTiers([]), null, 1));
  console.log("\nDry-run only. Re-run with --apply.");
  await pool.end();
  process.exit(0);
}

for (const row of blank) {
  try {
    // Schema-v1 rules have no `persona` block at all, so writing one back is rejected as an
    // unrecognized key. Lift them to v2 first — the same upgrade the authoring UI performs — then
    // fill the ladder.
    const { rules, alreadyV2 } = upgradeSourceRulesToV2(row.rulesJson);
    rules.persona = { ...rules.persona, titleTiers: execTiers([]) };
    if (!alreadyV2) console.log(`      ${row.name}: rules upgraded v1 -> v2 before the repair`);

    await saveIcpDraftRules(
      {
        organizationId: row.organizationId,
        draftVersionId: row.id,
        expectedVersion: row.version,
        rulesJson: rules,
      },
      db
    );

    console.log(`OK    ${row.name} v${row.versionNumber} (${row.id}): persona ladder added in place`);
  } catch (error) {
    console.log(`FAIL  ${row.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\nNext: re-score the existing assignments so the repaired rules reach the data:");
console.log("  node --env-file=.env scripts/rescore-icp.mjs --apply");

await pool.end();

// ── helpers ──────────────────────────────────────────────────────────────────

function hasPositivePersona(rulesJson) {
  const persona = rulesJson?.persona ?? {};
  return (
    (persona.titleAllowlist?.length ?? 0) > 0 ||
    (persona.titleTiers?.length ?? 0) > 0 ||
    (persona.titleKeywords?.length ?? 0) > 0
  );
}

function readNumberFlag(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function describePersona(rulesJson) {
  const persona = rulesJson?.persona ?? {};
  return `allow=${persona.titleAllowlist?.length ?? 0} tiers=${persona.titleTiers?.length ?? 0} kw=${persona.titleKeywords?.length ?? 0}`;
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
