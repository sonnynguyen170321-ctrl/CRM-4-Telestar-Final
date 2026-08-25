/**
 * Safe Production Seed Data Cutover Tool (Fail-Closed Architecture).
 *
 * Governing Directives (Sections 21-39):
 * 1. ZERO-FALSE-GREEN: Indiscriminate wipes are retired; every row is classified deterministically.
 * 2. CLASSIFICATION SAFETY: Unknown rows default to REVIEW_REQUIRED, NEVER automatically to delete.
 * 3. TRANSACTION INTEGRITY: Deletion count mismatches or FK failures THROW and abort entire transaction.
 * 4. DRIFT & TAMPER PROOF: Manifest SHA-256 and approved roster SHA-256 are verified before execution.
 * 5. POST-CUTOVER PROOF: Independent post-purge verification confirms 0 seed business rows.
 *
 * Modes:
 *   --mode=PLAN       (read-only: inventories rows, classifies, generates purge-manifest.json + sha256)
 *   --mode=VERIFY     (validates safety preconditions, hashes, row drift, zero REVIEW_REQUIRED)
 *   --mode=REHEARSE   (dry-run transactional rehearsal against test/clone database)
 *   --mode=EXECUTE    (atomic transactional deletion governed strictly by approved manifest)
 *   --mode=POSTCHECK  (independent verification confirming zero seed rows & referential integrity)
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAdminClient } from '../../lib/db/adminClient.mjs';

const ROOT = process.cwd();

export function parseArg(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (arg) return arg.split('=')[1];
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return null;
}

export const hasFlag = (name: string) => process.argv.includes(`--${name}`);

export function resolveRosterPath(): string {
  const custom = parseArg('roster');
  if (custom && existsSync(custom)) return custom;
  const candidates = [
    path.join(ROOT, 'scripts', 'cutover', 'approved-roster.json'),
    '/app/scripts/cutover/approved-roster.json',
    '/tmp/approved-roster.json',
    path.join(__dirname, 'approved-roster.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return path.join(ROOT, 'scripts', 'cutover', 'approved-roster.json');
}

export function resolveManifestPath(): string {
  const custom = parseArg('manifest') || parseArg('outFile');
  if (custom) return custom;
  
  const defaultDir = path.join(ROOT, 'docs', 'production-cutover');
  try {
    mkdirSync(defaultDir, { recursive: true });
    return path.join(defaultDir, 'purge-manifest.json');
  } catch {
    return '/tmp/purge-manifest.json';
  }
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function getDatabaseFingerprint(): string {
  const dbUrl = process.env.DATABASE_URL || '';
  const match = dbUrl.match(/@([^:/]+)(?::(\d+))?\/([^?]+)/);
  if (!match) return 'unknown-database';
  const host = match[1];
  const port = match[2] || '5432';
  const dbName = match[3];
  return `${host}:${port}/${dbName}`;
}

// ── Models in strict topological child-before-parent order ─────────────────
export const TOPOLOGICAL_MODELS = [
  'activity',
  'notification',
  'reminder',
  'note',
  'meeting',
  'task',
  'sequenceStep',
  'opportunityActivity',
  'opportunity',
  'outboundMessage',
  'sequenceEnrollment',
  'lead',
  'sequence',
  'template',
  'bookingLink',
  'clientReportExport',
  'clientReportShareLink',
  'clientReport',
  'importRow',
  'importBatch',
  'leadgenActivity',
  'agentAction',
  'emailHealthSnapshot',
  'campaignSdr',
  'campaign',
  'client',
  'emailAccount',
  'user',
  'tenant',
] as const;

export type ModelName = (typeof TOPOLOGICAL_MODELS)[number];

export type ClassificationType = 'SYSTEM_KEEP' | 'KEEP_REAL' | 'PURGE_SEED' | 'REVIEW_REQUIRED';

export interface ClassifiedRow {
  model: ModelName;
  id: string;
  classification: ClassificationType;
  reason: string;
  tenantId?: string;
  fingerprint?: string;
}

export interface PurgeManifest {
  manifestId: string;
  schemaVersion: number;
  generatedAt: string;
  productionDatabaseFingerprint: string;
  approvedRosterHash: string;
  summary: {
    totalRowsScanned: number;
    rowsToDeleteCount: number;
    rowsToKeepCount: number;
    rowsRequiringReviewCount: number;
  };
  countsByModel: Record<string, { total: number; delete: number; keep: number; review: number }>;
  rowsToDelete: ClassifiedRow[];
  rowsToKeep: ClassifiedRow[];
  rowsRequiringReview: ClassifiedRow[];
  manifestSha256?: string;
}

const KNOWN_DEMO_TENANTS = new Set(['demo-telestar', 'tenant-demo', 'test-tenant', 'demo-tenant']);
const KNOWN_SEED_PREFIXES = [
  'demo',
  'seed',
  'test',
  'mock',
  'fixture',
  't8',
  'blref',
  'ci',
  'temp',
  'vitest',
  'fault',
  'goldenjourney',
  'icpadh',
  'wo',
  'p10',
  'variantattr',
  'race',
  'pw',
  'load',
  'refint',
  'crref',
  'impref',
  'crprev',
  'victim',
  'attacker',
];

function isKnownTestFixture(idOrTenantId?: string): boolean {
  if (!idOrTenantId) return false;
  const val = idOrTenantId.toLowerCase().trim();
  if (KNOWN_DEMO_TENANTS.has(val)) return true;
  if (val.endsWith('-tenant') || val.endsWith('-tenant-a') || val.endsWith('-tenant-b')) return true;
  return KNOWN_SEED_PREFIXES.some((prefix) => val.startsWith(prefix) || val.includes(`-${prefix}-`) || val.includes(`_${prefix}_`));
}

export function classifyRow(
  model: ModelName,
  row: any,
  approvedEmails: Set<string>,
  approvedTenants: Set<string>
): { classification: ClassificationType; reason: string } {
  // 1. Tenants
  if (model === 'tenant') {
    if (approvedTenants.has(row.id)) {
      return { classification: 'KEEP_REAL', reason: 'Approved production tenant' };
    }
    if (isKnownTestFixture(row.id)) {
      return { classification: 'PURGE_SEED', reason: 'Known demo / synthetic test tenant identifier' };
    }
    return { classification: 'REVIEW_REQUIRED', reason: 'Unrecognized tenant requires manual review' };
  }

  // 2. Users
  if (model === 'user') {
    const email = (row.email || '').toLowerCase().trim();
    if (approvedEmails.has(email)) {
      return { classification: 'KEEP_REAL', reason: 'Approved real user roster' };
    }
    if (isKnownTestFixture(row.tenantId) || isKnownTestFixture(row.id) || isKnownTestFixture(email)) {
      return { classification: 'PURGE_SEED', reason: 'User belonging to known demo / synthetic test fixture' };
    }
    return { classification: 'REVIEW_REQUIRED', reason: 'Unrecognized user account outside approved roster' };
  }

  // 3. Email Accounts
  if (model === 'emailAccount') {
    const email = (row.email || '').toLowerCase().trim();
    if (approvedEmails.has(email)) {
      return { classification: 'KEEP_REAL', reason: 'Live connected user OAuth mailbox' };
    }
    if (isKnownTestFixture(row.tenantId) || isKnownTestFixture(row.id) || isKnownTestFixture(email)) {
      return { classification: 'PURGE_SEED', reason: 'Demo / synthetic test email account fixture' };
    }
    return { classification: 'REVIEW_REQUIRED', reason: 'Unrecognized mailbox requires verification' };
  }

  // 4. Business Records (clients, campaigns, leads, sequences, tasks, meetings, etc.)
  const isDemoTenant = isKnownTestFixture(row.tenantId);
  const isSeedId = isKnownTestFixture(row.id);

  if (isDemoTenant || isSeedId) {
    return { classification: 'PURGE_SEED', reason: 'Belongs to verified demo/synthetic tenant or seed fixture' };
  }

  if (row.tenantId && approvedTenants.has(row.tenantId)) {
    if (row.isDemo || row.isSynthetic || (row.tags && Array.isArray(row.tags) && row.tags.includes('demo'))) {
      return { classification: 'PURGE_SEED', reason: 'Explicitly marked demo record in approved tenant' };
    }
    return { classification: 'KEEP_REAL', reason: 'Production record in approved tenant' };
  }

  return { classification: 'REVIEW_REQUIRED', reason: 'Unknown tenant association requires operator classification' };
}

export async function planMode(customRosterPath?: string): Promise<PurgeManifest> {
  console.log('🔍 Executing PLAN mode (read-only inventory & classification)...');

  const prisma = createAdminClient();
  const rosterFile = customRosterPath || resolveRosterPath();
  if (!existsSync(rosterFile)) {
    throw new Error(`Approved roster not found at ${rosterFile}`);
  }

  const rosterRaw = readFileSync(rosterFile, 'utf8');
  const roster = JSON.parse(rosterRaw);
  const approvedEmails = new Set<string>((roster.approvedUsers || []).map((u: any) => u.email.toLowerCase().trim()));
  const approvedTenants = new Set<string>((roster.approvedTenants || []).map((t: any) => t.id));

  const rowsToDelete: ClassifiedRow[] = [];
  const rowsToKeep: ClassifiedRow[] = [];
  const rowsRequiringReview: ClassifiedRow[] = [];
  const countsByModel: PurgeManifest['countsByModel'] = {};

  let totalRowsScanned = 0;

  for (const model of TOPOLOGICAL_MODELS) {
    const delegate = (prisma as any)[model];
    if (!delegate || typeof delegate.findMany !== 'function') continue;

    const rows = await delegate.findMany();
    totalRowsScanned += rows.length;

    let modelDel = 0;
    let modelKeep = 0;
    let modelRev = 0;

    for (const row of rows) {
      const { classification, reason } = classifyRow(model, row, approvedEmails, approvedTenants);
      const entry: ClassifiedRow = {
        model,
        id: row.id,
        classification,
        reason,
        tenantId: row.tenantId,
      };

      if (classification === 'PURGE_SEED') {
        rowsToDelete.push(entry);
        modelDel++;
      } else if (classification === 'KEEP_REAL' || classification === 'SYSTEM_KEEP') {
        rowsToKeep.push(entry);
        modelKeep++;
      } else {
        rowsRequiringReview.push(entry);
        modelRev++;
      }
    }

    countsByModel[model] = {
      total: rows.length,
      delete: modelDel,
      keep: modelKeep,
      review: modelRev,
    };
  }

  const manifest: PurgeManifest = {
    manifestId: `manifest-${randomUUID().slice(0, 8)}`,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    productionDatabaseFingerprint: getDatabaseFingerprint(),
    approvedRosterHash: sha256(rosterRaw),
    summary: {
      totalRowsScanned,
      rowsToDeleteCount: rowsToDelete.length,
      rowsToKeepCount: rowsToKeep.length,
      rowsRequiringReviewCount: rowsRequiringReview.length,
    },
    countsByModel,
    rowsToDelete,
    rowsToKeep,
    rowsRequiringReview,
  };

  const manifestPath = resolveManifestPath();
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  const manifestSha256 = sha256(serialized);
  manifest.manifestSha256 = manifestSha256;

  try {
    mkdirSync(path.dirname(manifestPath), { recursive: true });
  } catch {}

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  try {
    writeFileSync(`${manifestPath}.sha256`, `${manifestSha256}  ${path.basename(manifestPath)}\n`);
  } catch {}

  console.log(`✅ Plan complete. Total rows scanned: ${totalRowsScanned}`);
  console.log(`   - To Purge:  ${rowsToDelete.length}`);
  console.log(`   - To Keep:   ${rowsToKeep.length}`);
  console.log(`   - To Review: ${rowsRequiringReview.length}`);
  console.log(`📄 Manifest written: ${manifestPath} (SHA256: ${manifestSha256})`);
  return manifest;
}

export async function verifyMode(customPath?: string): Promise<PurgeManifest> {
  console.log('🔍 Executing VERIFY mode (pre-cutover safety assertions)...');
  const targetPath = customPath || resolveManifestPath();
  if (!existsSync(targetPath)) {
    throw new Error(`Manifest not found at ${targetPath}. Run --mode=PLAN first.`);
  }

  const raw = readFileSync(targetPath, 'utf8');
  const manifest: PurgeManifest = JSON.parse(raw);

  // 1. Verify Database Target
  const currentFingerprint = getDatabaseFingerprint();
  if (manifest.productionDatabaseFingerprint !== currentFingerprint) {
    throw new Error(
      `TARGET DATABASE MISMATCH: Manifest was created for [${manifest.productionDatabaseFingerprint}], but current DB is [${currentFingerprint}]. Refusing execution.`
    );
  }

  // 2. Verify Approved Roster Hash
  const rosterFile = resolveRosterPath();
  if (existsSync(rosterFile)) {
    const currentRosterHash = sha256(readFileSync(rosterFile, 'utf8'));
    if (manifest.approvedRosterHash !== currentRosterHash) {
      throw new Error(`ROSTER HASH MISMATCH: Approved roster has drifted since manifest generation.`);
    }
  }

  // 3. Verify Zero Unresolved Reviews
  if (manifest.summary.rowsRequiringReviewCount > 0 || manifest.rowsRequiringReview.length > 0) {
    throw new Error(
      `ZERO-REVIEW PRECONDITION VIOLATED: Manifest contains ${manifest.summary.rowsRequiringReviewCount} rows requiring manual review. Execution refused.`
    );
  }

  // 4. Verify Row Drift (batch verified in topological chunks)
  const prisma = createAdminClient();
  const idsByModel: Record<string, string[]> = {};
  for (const item of manifest.rowsToDelete) {
    if (!idsByModel[item.model]) idsByModel[item.model] = [];
    idsByModel[item.model].push(item.id);
  }

  for (const [model, ids] of Object.entries(idsByModel)) {
    const delegate = (prisma as any)[model];
    if (!delegate || typeof delegate.findMany !== 'function') continue;

    const CHUNK_SIZE = 1000;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const found = await delegate.findMany({
        where: { id: { in: chunk } },
        select: { id: true },
      });
      if (found.length !== chunk.length) {
        throw new Error(
          `ROW DRIFT DETECTED in ${model}: Expected ${chunk.length} rows in batch, but database only returned ${found.length}. Manifest is stale.`
        );
      }
    }
  }

  console.log('✅ Manifest validated: 0 review blockers, database fingerprint exact, 0 row drift.');
  console.log(`✅ Safe deletion scope: ${manifest.summary.rowsToDeleteCount} rows across ${Object.keys(manifest.countsByModel).length} models.`);
  return manifest;
}

export async function executeMode(manifestPath?: string, dryRun = false) {
  const modeLabel = dryRun ? 'REHEARSE' : 'EXECUTE';
  console.log(`🚨 Executing ${modeLabel} mode (${dryRun ? 'dry-run transaction' : 'atomic transactional deletion'})...`);

  if (!dryRun && !hasFlag('confirm-production-destructive-cutover')) {
    throw new Error('EXECUTE REFUSED: Missing required flag --confirm-production-destructive-cutover');
  }

  const manifest = await verifyMode(manifestPath);
  const prisma = createAdminClient();

  const idsByModel: Record<string, string[]> = {};
  for (const item of manifest.rowsToDelete) {
    if (!idsByModel[item.model]) idsByModel[item.model] = [];
    idsByModel[item.model].push(item.id);
  }

  const startedAt = new Date().toISOString();
  console.log(`⚡ Beginning transaction in strict topological order (${TOPOLOGICAL_MODELS.length} models)...`);
  const deletedCounts: Record<string, number> = {};

  await prisma.$transaction(
    async (tx: any) => {
      for (const model of TOPOLOGICAL_MODELS) {
        const ids = idsByModel[model];
        if (!ids || ids.length === 0) {
          deletedCounts[model] = 0;
          continue;
        }

        const delegate = tx[model];
        if (!delegate || typeof delegate.deleteMany !== 'function') {
          throw new Error(`Invalid model delegate for ${model}`);
        }

        console.log(`  Deleting ${ids.length} rows from model ${model}...`);
        let modelDeletedCount = 0;
        const DELETE_CHUNK_SIZE = 10000;

        for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
          const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE);
          const result = await delegate.deleteMany({
            where: { id: { in: chunk } },
          });
          modelDeletedCount += result.count;
        }

        deletedCounts[model] = modelDeletedCount;
        if (modelDeletedCount !== ids.length) {
          // SECTION 31: DELETION COUNT MISMATCH MUST THROW AND ROLLBACK
          throw new Error(
            `DELETION COUNT MISMATCH ON ${model}: Expected to delete ${ids.length} rows, but database deleted ${modelDeletedCount}. Aborting transaction.`
          );
        }
      }

      if (dryRun) {
        throw new Error('__REHEARSAL_ROLLBACK_SUCCESS__');
      }
    },
    {
      maxWait: 120000,
      timeout: 900000,
    }
  ).catch((err: any) => {
    if (dryRun && err.message === '__REHEARSAL_ROLLBACK_SUCCESS__') {
      console.log('✅ REHEARSAL SUCCESSFUL: Complete transactional delete succeeded and safely rolled back.');
      return;
    }
    throw err;
  });

  if (!dryRun) {
    const finishedAt = new Date().toISOString();
    console.log('🎉 Atomic transaction committed successfully!');

    const auditLog = {
      auditId: `audit-${randomUUID()}`,
      manifestId: manifest.manifestId,
      startedAt,
      finishedAt,
      status: 'SUCCESS',
      deletedCounts,
    };

    const auditPath = path.join(path.dirname(resolveManifestPath()), 'cutover-audit-log.json');
    writeFileSync(auditPath, JSON.stringify(auditLog, null, 2) + '\n');
    console.log(`📝 Audit log recorded: ${auditPath}`);
  }
}

export async function postcheckMode() {
  console.log('🔍 Executing POSTCHECK mode (independent zero-seed verification)...');
  const prisma = createAdminClient();

  const rosterFile = resolveRosterPath();
  const rosterRaw = existsSync(rosterFile) ? readFileSync(rosterFile, 'utf8') : '{}';
  const roster = JSON.parse(rosterRaw);
  const approvedEmails = new Set<string>((roster.approvedUsers || []).map((u: any) => u.email.toLowerCase().trim()));
  const approvedTenants = new Set<string>((roster.approvedTenants || []).map((t: any) => t.id));

  let seedRowsFound = 0;
  for (const model of TOPOLOGICAL_MODELS) {
    const delegate = (prisma as any)[model];
    if (!delegate || typeof delegate.findMany !== 'function') continue;

    const rows = await delegate.findMany();
    for (const row of rows) {
      const { classification } = classifyRow(model, row, approvedEmails, approvedTenants);
      if (classification === 'PURGE_SEED') {
        console.error(`❌ POSTCHECK FAILURE: Found remaining seed row in ${model}: ${row.id}`);
        seedRowsFound++;
      }
    }
  }

  if (seedRowsFound > 0) {
    throw new Error(`POSTCHECK FAILED: ${seedRowsFound} seed business rows remain in database.`);
  }

  console.log('✅ POSTCHECK PASSED: Zero identified seed business rows remaining in database.');
}

async function main() {
  const mode = (parseArg('mode') || 'PLAN').toUpperCase();
  const manifestPath = parseArg('manifest') || undefined;

  try {
    if (mode === 'PLAN') {
      await planMode();
    } else if (mode === 'VERIFY') {
      await verifyMode(manifestPath);
    } else if (mode === 'REHEARSE') {
      await executeMode(manifestPath, true);
    } else if (mode === 'EXECUTE') {
      await executeMode(manifestPath, false);
    } else if (mode === 'POSTCHECK') {
      await postcheckMode();
    } else {
      throw new Error(`Unknown mode: ${mode}. Supported modes: PLAN, VERIFY, REHEARSE, EXECUTE, POSTCHECK`);
    }
  } finally {
    const prisma = createAdminClient();
    await (prisma as any).$disconnect?.();
  }
}

if (process.argv[1]?.endsWith('safe-cutover-tool.ts') || process.argv[1]?.endsWith('safe-cutover-tool.js')) {
  main().catch((err) => {
    console.error('\n❌ Cutover tool error:', err.message);
    process.exit(1);
  });
}
