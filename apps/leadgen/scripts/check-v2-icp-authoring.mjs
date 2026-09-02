import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Pool } = require("pg");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

loadEnvFiles([".env.local", ".env", ".env.production"]);

const {
  cloneIcpVersionAsDraft,
  publishIcpDraft,
  saveIcpDraftRules,
  validateAnyIcpRules,
} = loadTsModule("lib/v2/icp/authoring.ts");
const { TELESTAR } = loadTsModule("lib/v2/scoring/__fixtures__/icpCorpus/index.ts");
const { TELESTAR_SDR_OUTSOURCING_ICP_RULES } = loadTsModule(
  "lib/v2/scoring/__fixtures__/sampleIcpRules.ts"
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = createPgDb(pool);

const ids = {
  organization: "icp_authoring_smoke_org",
  otherOrganization: "icp_authoring_smoke_other_org",
  user: "icp_authoring_smoke_user",
  account: "icp_authoring_smoke_account",
  project: "icp_authoring_smoke_project",
  offer: "icp_authoring_smoke_offer",
  profile: "icp_authoring_smoke_profile",
  sourceVersion: "icp_authoring_smoke_source_version",
};

try {
  await cleanupSmokeData();
  await seedSmokeData();

  assert.equal(validateAnyIcpRules(TELESTAR_SDR_OUTSOURCING_ICP_RULES).schemaVersion, "v1");
  assert.equal(validateAnyIcpRules(TELESTAR).schemaVersion, "v2");
  console.log("PASS authoring validates legacy v1 and schema-v2 rules");

  const cloned = await cloneIcpVersionAsDraft(
    {
      organizationId: ids.organization,
      sourceVersionId: ids.sourceVersion,
    },
    db
  );
  assert.equal(cloned.versionNumber, 2);
  assert.equal(cloned.optimisticVersion, 1);
  const draftBefore = await readIcpVersion(cloned.draftVersionId);
  assert.equal(draftBefore.status, "DRAFT");
  assert.equal(draftBefore.rulesJson.schemaVersion, "v2");
  console.log("PASS clone published ICP -> draft");

  const editedRules = {
    ...TELESTAR,
    scorePolicy: {
      ...TELESTAR.scorePolicy,
      qualifiedMinFitScore: 76,
      needsReviewMinFitScore: 46,
    },
    requiredEvidenceForFinalQualification: {
      ...TELESTAR.requiredEvidenceForFinalQualification,
      employeeSize: false,
    },
  };
  const saved = await saveIcpDraftRules(
    {
      organizationId: ids.organization,
      draftVersionId: cloned.draftVersionId,
      expectedVersion: cloned.optimisticVersion,
      rulesJson: editedRules,
    },
    db
  );
  assert.equal(saved.optimisticVersion, 2);
  const draftAfterSave = await readIcpVersion(cloned.draftVersionId);
  assert.equal(draftAfterSave.rulesJson.scorePolicy.qualifiedMinFitScore, 76);
  assert.equal(draftAfterSave.rulesJson.requiredEvidenceForFinalQualification.employeeSize, false);
  console.log("PASS edit draft rules -> validation succeeds");

  await assertRejectsMessage(
    () =>
      saveIcpDraftRules(
        {
          organizationId: ids.organization,
          draftVersionId: cloned.draftVersionId,
          expectedVersion: saved.optimisticVersion,
          rulesJson: {
            ...editedRules,
            scoringWeights: { ...editedRules.scoringWeights, signals: 99 },
          },
        },
        db
      ),
    "scoring weights must sum to 100"
  );
  console.log("PASS invalid schema-v2 weights rejected");

  await assertRejectsMessage(
    () =>
      saveIcpDraftRules(
        {
          organizationId: ids.otherOrganization,
          draftVersionId: cloned.draftVersionId,
          expectedVersion: saved.optimisticVersion,
          rulesJson: editedRules,
        },
        db
      ),
    "not found"
  );
  console.log("PASS tenant isolation rejects cross-org draft edit");

  const published = await publishIcpDraft(
    {
      organizationId: ids.organization,
      userId: ids.user,
      draftVersionId: cloned.draftVersionId,
      expectedVersion: saved.optimisticVersion,
    },
    db
  );
  assert.equal(published.versionNumber, 2);
  assert.equal(published.optimisticVersion, 3);
  const publishedRow = await readIcpVersion(cloned.draftVersionId);
  assert.equal(publishedRow.status, "PUBLISHED");
  assert.equal(publishedRow.publishedByUserId, ids.user);
  assert.ok(publishedRow.publishedAt);
  console.log("PASS publish draft -> immutable published version with OCC");

  await assertRejectsMessage(
    () =>
      publishIcpDraft(
        {
          organizationId: ids.organization,
          userId: ids.user,
          draftVersionId: cloned.draftVersionId,
          expectedVersion: saved.optimisticVersion,
        },
        db
      ),
    "Only draft"
  );
  console.log("PASS stale/non-draft publish rejected");

  await cleanupSmokeData();
  console.log("PASS V2 ICP authoring SC5 smoke checks complete");
} finally {
  await pool.end();
}

async function seedSmokeData() {
  await insertOrganization(ids.organization, "ICP Authoring Smoke", "icp-authoring-smoke");
  await insertOrganization(ids.otherOrganization, "ICP Authoring Other", "icp-authoring-other");
  await pool.query(
    `
      INSERT INTO "V2User" ("id", "email", "emailNormalized", "status", "createdAt", "updatedAt")
      VALUES ($1, 'icp-authoring-smoke@example.test', 'icp-authoring-smoke@example.test', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.user]
  );
  await pool.query(
    `
      INSERT INTO "V2ClientAccount" ("id", "organizationId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, 'Authoring Account', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.account, ids.organization]
  );
  await pool.query(
    `
      INSERT INTO "V2Project" ("id", "organizationId", "clientAccountId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'Authoring Project', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.project, ids.organization, ids.account]
  );
  await pool.query(
    `
      INSERT INTO "V2Offer" ("id", "organizationId", "projectId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'Authoring Offer', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.offer, ids.organization, ids.project]
  );
  await pool.query(
    `
      INSERT INTO "V2ICPProfile" ("id", "organizationId", "offerId", "name", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'Authoring ICP', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.profile, ids.organization, ids.offer]
  );
  await pool.query(
    `
      INSERT INTO "V2ICPVersion" (
        "id", "organizationId", "icpProfileId", "versionNumber", "status", "rulesJson",
        "publishedAt", "publishedByUserId", "version", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, 1, 'PUBLISHED', $4::jsonb, CURRENT_TIMESTAMP, $5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [ids.sourceVersion, ids.organization, ids.profile, JSON.stringify(TELESTAR), ids.user]
  );
}

async function insertOrganization(id, name, slug) {
  await pool.query(
    `
      INSERT INTO "V2Organization" ("id", "name", "slug", "status", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [id, name, slug]
  );
}

async function readIcpVersion(versionId) {
  const result = await pool.query(
    `
      SELECT
        "id",
        "status"::text AS "status",
        "versionNumber",
        "version",
        "rulesJson",
        "publishedAt",
        "publishedByUserId"
      FROM "V2ICPVersion"
      WHERE "id" = $1 AND "organizationId" = $2
    `,
    [versionId, ids.organization]
  );
  assert.ok(result.rows[0], `Expected ICP version ${versionId}`);
  return result.rows[0];
}

async function cleanupSmokeData() {
  await pool.query(`DELETE FROM "V2ICPVersion" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2ICPProfile" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2Offer" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2Project" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2ClientAccount" WHERE "organizationId" = $1`, [ids.organization]);
  await pool.query(`DELETE FROM "V2User" WHERE "id" = $1`, [ids.user]);
  await pool.query(`DELETE FROM "V2Organization" WHERE "id" = ANY($1::text[])`, [
    [ids.organization, ids.otherOrganization],
  ]);
}

async function assertRejectsMessage(fn, fragment) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof Error);
    assert.ok(
      error.message.toLowerCase().includes(fragment.toLowerCase()),
      `Expected error "${error.message}" to include "${fragment}"`
    );
    return true;
  });
}

function createPgDb(poolOrClient) {
  return {
    async $queryRawUnsafe(query, ...values) {
      const result = await poolOrClient.query(query, values);
      return result.rows;
    },
    async $executeRawUnsafe(query, ...values) {
      const result = await poolOrClient.query(query, values);
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

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = resolve(rootDir, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    }
  }
}

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);

  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);

  const localRequire = (specifier) => {
    if (specifier === "server-only") {
      return {};
    }

    if (specifier.startsWith("@/")) {
      const aliasPath = resolve(rootDir, specifier.slice(2));
      const resolvedPath = existsSync(`${aliasPath}.ts`)
        ? `${aliasPath}.ts`
        : resolve(aliasPath, "index.ts");

      return loadTsModule(resolvedPath.slice(rootDir.length + 1));
    }

    if (!specifier.startsWith(".")) {
      return require(specifier);
    }

    const modulePath = resolve(dirname(absolutePath), specifier);
    const resolvedPath = existsSync(`${modulePath}.ts`)
      ? `${modulePath}.ts`
      : resolve(modulePath, "index.ts");
    const relativeToRoot = resolvedPath.slice(rootDir.length + 1);

    return loadTsModule(relativeToRoot);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    loadedModule,
    loadedModule.exports
  );

  return loadedModule.exports;
}
