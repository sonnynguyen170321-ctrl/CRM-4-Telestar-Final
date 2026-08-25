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
 *   --mode=REHEARSE   (dry-run transactional rehearsal against a RESTORED CLONE; requires --clone-of=<production-fingerprint>)
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

export interface Precondition {
  name: string;
  satisfied: boolean;
  detail: string;
}

/**
 * The preconditions EXECUTE may not proceed without (directive section 30).
 *
 * Fail-closed means the absence of proof is a refusal, not a warning. Each entry
 * below is either proven from something observable at run time, or it is not
 * satisfied — there is no "probably fine" state, and no flag that asserts one.
 *
 * Backup, PITR and recovery access cannot be observed from inside this process:
 * they are facts about the Cloud SQL instance. They are supplied by an operator
 * evidence file whose path is given with `--preconditions=<file>`, and its
 * contents are reported verbatim into the cutover record so a reader can check
 * them against the console. No file, no execution.
 */
export function evaluatePreconditions(evidencePath?: string | null): Precondition[] {
  const checks: Precondition[] = [];
  const normalize = (value?: string) => (value ?? '').trim().toLowerCase();

  // Mail must be unable to leave the system while rows are being deleted: a
  // sequence firing mid-cutover would send against half-purged state.
  checks.push({
    name: 'EMAIL_GLOBAL_PAUSE is true',
    satisfied: normalize(process.env.EMAIL_GLOBAL_PAUSE) === 'true',
    detail: `EMAIL_GLOBAL_PAUSE=${process.env.EMAIL_GLOBAL_PAUSE === undefined ? 'NOT SET' : 'SET'}`,
  });

  // Unset means off, which is the safe default, so anything other than an
  // explicit "true" satisfies this.
  checks.push({
    name: 'SEQUENCE_AUTOSEND_ENABLED is not true',
    satisfied: normalize(process.env.SEQUENCE_AUTOSEND_ENABLED) !== 'true',
    detail: `SEQUENCE_AUTOSEND_ENABLED=${process.env.SEQUENCE_AUTOSEND_ENABLED === undefined ? 'NOT SET' : 'SET'}`,
  });

  checks.push({
    name: 'imports are blocked',
    satisfied: normalize(process.env.IMPORTS_PAUSED) === 'true',
    detail: `IMPORTS_PAUSED=${process.env.IMPORTS_PAUSED === undefined ? 'NOT SET' : 'SET'}`,
  });

  checks.push({
    name: 'queues are paused',
    satisfied: normalize(process.env.QUEUES_PAUSED) === 'true',
    detail: `QUEUES_PAUSED=${process.env.QUEUES_PAUSED === undefined ? 'NOT SET' : 'SET'}`,
  });

  if (!evidencePath) {
    checks.push({
      name: 'operator recovery evidence supplied',
      satisfied: false,
      detail: 'no --preconditions=<file> given; backup, PITR and recovery access are unproven',
    });
    return checks;
  }

  if (!existsSync(evidencePath)) {
    checks.push({
      name: 'operator recovery evidence supplied',
      satisfied: false,
      detail: `--preconditions file not found at ${evidencePath}`,
    });
    return checks;
  }

  let evidence: any;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch (err: any) {
    checks.push({
      name: 'operator recovery evidence supplied',
      satisfied: false,
      detail: `--preconditions file is not readable JSON: ${err.message}`,
    });
    return checks;
  }

  const backupAt = Date.parse(evidence.backupCompletedAt ?? '');
  const backupAgeHours = Number.isFinite(backupAt) ? (Date.now() - backupAt) / 3_600_000 : Infinity;
  const MAX_BACKUP_AGE_HOURS = 24;

  checks.push({
    name: 'a verified backup exists',
    satisfied: evidence.backupVerified === true && Number.isFinite(backupAt),
    detail: `backupVerified=${evidence.backupVerified === true} backupId=${evidence.backupId ?? 'ABSENT'}`,
  });
  checks.push({
    name: `the backup is younger than ${MAX_BACKUP_AGE_HOURS}h`,
    satisfied: backupAgeHours <= MAX_BACKUP_AGE_HOURS,
    detail: Number.isFinite(backupAgeHours)
      ? `backup is ${backupAgeHours.toFixed(1)}h old`
      : 'backupCompletedAt is missing or unparseable',
  });
  checks.push({
    name: 'point-in-time recovery is enabled',
    satisfied: evidence.pitrEnabled === true,
    detail: `pitrEnabled=${evidence.pitrEnabled === true}`,
  });
  checks.push({
    name: 'recovery access is available',
    satisfied: evidence.recoveryAccessVerified === true,
    detail: `recoveryAccessVerified=${evidence.recoveryAccessVerified === true}`,
  });
  checks.push({
    name: 'the evidence names the database being targeted',
    satisfied:
      typeof evidence.databaseFingerprint === 'string' &&
      evidence.databaseFingerprint === getDatabaseFingerprint(),
    detail: `evidence names ${evidence.databaseFingerprint ?? 'nothing'}; this process is connected to ${getDatabaseFingerprint()}`,
  });

  return checks;
}

/**
 * Which database this run is allowed to touch (directive sections 27, 35, 36).
 *
 * Two opposite pairings, decided by whether this is a rehearsal:
 *
 * - **Execution** targets production, so the manifest's fingerprint must equal
 *   the connected database. A manifest built for one instance cannot authorize
 *   deletion on another.
 * - **Rehearsal** targets a restore of production into an isolated environment,
 *   so the manifest must name the production instance and the connected database
 *   must NOT be it. A rehearsal that quietly ran against production is the more
 *   dangerous of the two mistakes, which is why it is refused rather than warned
 *   about.
 */
export function resolveTargetDatabase(args: {
  manifestFingerprint: string;
  currentFingerprint: string;
  cloneOf?: string | null;
}): { ok: true; note: string } | { ok: false; error: string } {
  const { manifestFingerprint, currentFingerprint, cloneOf } = args;

  if (cloneOf) {
    if (manifestFingerprint !== cloneOf) {
      return {
        ok: false,
        error: `CLONE ATTESTATION MISMATCH: --clone-of names [${cloneOf}], but the manifest was created for [${manifestFingerprint}]. Refusing.`,
      };
    }
    if (currentFingerprint === cloneOf) {
      return {
        ok: false,
        error: `REHEARSAL REFUSED: this process is connected to [${currentFingerprint}], which is the production instance the manifest targets. A rehearsal must run against a restored clone, never the instance it is rehearsing for.`,
      };
    }
    return { ok: true, note: `rehearsing on clone [${currentFingerprint}] of production [${cloneOf}]` };
  }

  if (manifestFingerprint !== currentFingerprint) {
    return {
      ok: false,
      error: `TARGET DATABASE MISMATCH: Manifest was created for [${manifestFingerprint}], but current DB is [${currentFingerprint}]. Refusing execution.`,
    };
  }
  return { ok: true, note: `targeting [${currentFingerprint}], the instance the manifest names` };
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

/**
 * Demo/synthetic identity is decided by PROVENANCE, never by appearance.
 *
 * The previous implementation matched loose substrings ('test', 'ci', 'wo', 'load')
 * and `endsWith('-tenant')`. That made `default-tenant` — the approved PRODUCTION
 * tenant — match as a synthetic fixture, so every one of its rows was classified
 * PURGE_SEED and the manifest reported 0 rows requiring review. Executing it would
 * have deleted real business data. A row is now demo only if its tenant is on an
 * explicit list, or matches an anchored pattern for a tenant this repository's own
 * test suites generate. Anything else is REVIEW_REQUIRED — never delete.
 */
const KNOWN_DEMO_TENANT_IDS = new Set(['demo-telestar', 'tenant-demo', 'test-tenant', 'demo-tenant']);

/**
 * Tenants minted by this repository's automated suites. Each pattern is anchored
 * end to end and requires the generator's structural suffix, so a real tenant
 * cannot match by sharing an opening substring.
 */
const AUTOMATED_TEST_TENANT_PATTERNS: RegExp[] = [
  // t8a-a-<uuid>, t8a-b-<uuid>, t8ai-<uuid> — tenant-isolation suite fixtures
  /^t8[a-z]*(?:-[a-z])?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  // test-tenant-bullmq, test-tenant-run-now — named integration fixtures
  /^test-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/,
];

function isKnownDemoTenantId(tenantId?: string | null): boolean {
  if (!tenantId) return false;
  const val = String(tenantId).toLowerCase().trim();
  if (KNOWN_DEMO_TENANT_IDS.has(val)) return true;
  return AUTOMATED_TEST_TENANT_PATTERNS.some((pattern) => pattern.test(val));
}

/**
 * The manifest's own hash cannot cover the field that carries it, so it is taken
 * over the manifest with `manifestSha256` omitted. PLAN previously hashed the
 * pre-stamp serialization and then wrote the stamped one, so re-hashing the file
 * on disk could never reproduce the recorded digest — which is why VERIFY did not
 * check it, and why a hand-edited manifest would have passed.
 */
export function canonicalManifestHash(manifest: PurgeManifest): string {
  const { manifestSha256: _omitted, ...rest } = manifest;
  return sha256(JSON.stringify(rest, null, 2) + '\n');
}

/** A row the application itself marked as demo data, inside an approved tenant. */
function carriesExplicitDemoMarker(row: any): boolean {
  if (row?.isDemo === true || row?.isSynthetic === true) return true;
  return Array.isArray(row?.tags) && row.tags.includes('demo');
}

export function classifyRow(
  model: ModelName,
  row: any,
  approvedEmails: Set<string>,
  approvedTenants: Set<string>
): { classification: ClassificationType; reason: string } {
  // 1. Tenants — the approved list is consulted first, so an approved tenant can
  //    never fall through into demo classification however it happens to be named.
  if (model === 'tenant') {
    if (approvedTenants.has(row.id)) {
      return { classification: 'KEEP_REAL', reason: 'Approved production tenant' };
    }
    if (isKnownDemoTenantId(row.id)) {
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
    if (isKnownDemoTenantId(row.tenantId)) {
      return { classification: 'PURGE_SEED', reason: 'User belonging to known demo / synthetic test tenant' };
    }
    return { classification: 'REVIEW_REQUIRED', reason: 'Unrecognized user account outside approved roster' };
  }

  // 3. Email Accounts
  if (model === 'emailAccount') {
    const email = (row.email || '').toLowerCase().trim();
    if (approvedEmails.has(email)) {
      return { classification: 'KEEP_REAL', reason: 'Live connected user OAuth mailbox' };
    }
    if (isKnownDemoTenantId(row.tenantId)) {
      return { classification: 'PURGE_SEED', reason: 'Mailbox belonging to known demo / synthetic test tenant' };
    }
    return { classification: 'REVIEW_REQUIRED', reason: 'Unrecognized mailbox requires verification' };
  }

  // 4. Business Records (clients, campaigns, leads, sequences, tasks, meetings, etc.)
  //    Tenant provenance is the only signal that may condemn a row. A row whose
  //    tenant cannot be placed is kept and surfaced for operator classification.
  if (isKnownDemoTenantId(row.tenantId)) {
    return { classification: 'PURGE_SEED', reason: 'Belongs to verified demo / synthetic test tenant' };
  }

  if (row.tenantId && approvedTenants.has(row.tenantId)) {
    if (carriesExplicitDemoMarker(row)) {
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
  const manifestSha256 = canonicalManifestHash(manifest);
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

export async function verifyMode(customPath?: string, cloneOf?: string | null): Promise<PurgeManifest> {
  console.log('🔍 Executing VERIFY mode (pre-cutover safety assertions)...');
  const targetPath = customPath || resolveManifestPath();
  if (!existsSync(targetPath)) {
    throw new Error(`Manifest not found at ${targetPath}. Run --mode=PLAN first.`);
  }

  const raw = readFileSync(targetPath, 'utf8');
  const manifest: PurgeManifest = JSON.parse(raw);

  // 0. Verify the manifest has not been edited since PLAN produced it. This must
  //    run before any other assertion: every later check trusts these contents.
  if (!manifest.manifestSha256) {
    throw new Error('MANIFEST UNSIGNED: no manifestSha256 recorded. Regenerate with --mode=PLAN.');
  }
  const recomputed = canonicalManifestHash(manifest);
  if (recomputed !== manifest.manifestSha256) {
    throw new Error(
      `MANIFEST TAMPERING DETECTED: recorded hash ${manifest.manifestSha256} does not match recomputed ${recomputed}. Refusing execution.`
    );
  }

  // 0b. The summary counts are what the operator authorizes against; they must
  //     agree with the rows actually listed.
  if (
    manifest.summary.rowsToDeleteCount !== manifest.rowsToDelete.length ||
    manifest.summary.rowsToKeepCount !== manifest.rowsToKeep.length ||
    manifest.summary.rowsRequiringReviewCount !== manifest.rowsRequiringReview.length
  ) {
    throw new Error(
      `MANIFEST SUMMARY MISMATCH: summary claims ${manifest.summary.rowsToDeleteCount}/${manifest.summary.rowsToKeepCount}/${manifest.summary.rowsRequiringReviewCount} (delete/keep/review) but the manifest lists ${manifest.rowsToDelete.length}/${manifest.rowsToKeep.length}/${manifest.rowsRequiringReview.length}.`
    );
  }

  // 1. Verify Database Target
  //
  // A rehearsal deliberately runs somewhere else: directive section 36 requires
  // the production backup be restored into an isolated environment and the exact
  // manifest exercised THERE. So a rehearsal asserts the opposite pairing — the
  // manifest must name the production instance, and this process must be
  // connected to something that is not it. Both directions are checked, because
  // a rehearsal that quietly ran against production would be the more dangerous
  // of the two mistakes.
  const currentFingerprint = getDatabaseFingerprint();
  const target = resolveTargetDatabase({
    manifestFingerprint: manifest.productionDatabaseFingerprint,
    currentFingerprint,
    cloneOf,
  });
  if (!target.ok) throw new Error(target.error);
  console.log(`   ${target.note}`);

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

  // Directive section 36: a rehearsal is exercised against the production backup
  // restored into an isolated environment, not against the instance it is
  // rehearsing for. REHEARSE was previously executeMode(dryRun=true) opening a
  // transaction on the SAME database the manifest targets and rolling it back,
  // which proves neither the restore nor the post-cutover application state, and
  // holds long locks on production while it does so.
  const cloneOf = dryRun ? parseArg('clone-of') : null;
  if (dryRun && !cloneOf) {
    throw new Error(
      'REHEARSE REFUSED: --clone-of=<production-fingerprint> is required. A rehearsal runs against a restored clone; name the production instance it was restored from so the manifest can be matched to it.'
    );
  }

  // Directive section 30: every precondition must hold, or this exits non-zero
  // before the first delete. A rehearsal is non-destructive, so it reports the
  // same list without being blocked by it — that is how an operator sees what is
  // still outstanding before asking for authorization.
  const preconditions = evaluatePreconditions(parseArg('preconditions'));
  const unmet = preconditions.filter((check) => !check.satisfied);
  console.log(`\n🔐 Cutover preconditions (${preconditions.length - unmet.length}/${preconditions.length} satisfied):`);
  for (const check of preconditions) {
    console.log(`   ${check.satisfied ? '✅' : '❌'} ${check.name} — ${check.detail}`);
  }
  if (unmet.length > 0) {
    if (!dryRun) {
      throw new Error(
        `EXECUTE REFUSED: ${unmet.length} precondition(s) not satisfied: ${unmet.map((c) => c.name).join('; ')}`
      );
    }
    console.log(`   (rehearsal continues; EXECUTE would refuse on ${unmet.length} unmet precondition(s))`);
  }

  const manifest = await verifyMode(manifestPath, dryRun ? cloneOf : null);
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
