import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
  allModelDelegateNames,
  canonicalManifestHash,
  classifyRow,
  evaluatePreconditions,
  PurgeManifest,
  resolveTargetDatabase,
  TOPOLOGICAL_MODELS,
} from '../scripts/cutover/safe-cutover-tool';

describe('Safe Production Cutover Tool — Behavioral & Fail-Closed Suite', () => {
  const approvedEmails = new Set(['dean@telestar.vn', 'sonnynguyenofficial@gmail.com', 'alayna@itelestar.com']);
  const approvedTenants = new Set(['default-tenant']);

  describe('Row Classification Logic (Sections 23-24)', () => {
    it('classifies approved tenants as KEEP_REAL and unknown tenants as REVIEW_REQUIRED', () => {
      const approved = classifyRow('tenant', { id: 'default-tenant' }, approvedEmails, approvedTenants);
      expect(approved.classification).toBe('KEEP_REAL');

      const knownDemo = classifyRow('tenant', { id: 'demo-telestar' }, approvedEmails, approvedTenants);
      expect(knownDemo.classification).toBe('PURGE_SEED');

      const unknown = classifyRow('tenant', { id: 'mystery-corp' }, approvedEmails, approvedTenants);
      expect(unknown.classification).toBe('REVIEW_REQUIRED');
      expect(unknown.reason).toContain('requires manual review');
    });

    it('classifies approved users as KEEP_REAL, known demo as PURGE_SEED, unknown as REVIEW_REQUIRED', () => {
      const approvedUser = classifyRow('user', { email: 'dean@telestar.vn', id: 'usr-1' }, approvedEmails, approvedTenants);
      expect(approvedUser.classification).toBe('KEEP_REAL');

      const demoUser = classifyRow('user', { email: 'test@demo.com', id: 'demo-user-1', tenantId: 'demo-telestar' }, approvedEmails, approvedTenants);
      expect(demoUser.classification).toBe('PURGE_SEED');

      // Crucial Directive Section 23: Unknown user must NEVER default to delete
      const unknownUser = classifyRow('user', { email: 'contractor@external.com', id: 'usr-999', tenantId: 'default-tenant' }, approvedEmails, approvedTenants);
      expect(unknownUser.classification).toBe('REVIEW_REQUIRED');
    });

    it('classifies unknown business rows as REVIEW_REQUIRED, never defaulting to delete', () => {
      const unknownCampaign = classifyRow('campaign', { id: 'camp-123', tenantId: 'unregistered-tenant' }, approvedEmails, approvedTenants);
      expect(unknownCampaign.classification).toBe('REVIEW_REQUIRED');

      const approvedLead = classifyRow('lead', { id: 'lead-real-1', tenantId: 'default-tenant' }, approvedEmails, approvedTenants);
      expect(approvedLead.classification).toBe('KEEP_REAL');

      const demoLead = classifyRow('lead', { id: 'demo-lead-1', tenantId: 'demo-telestar' }, approvedEmails, approvedTenants);
      expect(demoLead.classification).toBe('PURGE_SEED');
    });
  });

  describe('Topological Order & Model Completeness', () => {
    it('ensures TOPOLOGICAL_MODELS lists child models before parents (e.g. activities before leads, leads before campaigns, campaigns before tenants)', () => {
      const activityIndex = TOPOLOGICAL_MODELS.indexOf('activity');
      const leadIndex = TOPOLOGICAL_MODELS.indexOf('lead');
      const campaignIndex = TOPOLOGICAL_MODELS.indexOf('campaign');
      const tenantIndex = TOPOLOGICAL_MODELS.indexOf('tenant');

      expect(activityIndex).toBeLessThan(leadIndex);
      expect(leadIndex).toBeLessThan(campaignIndex);
      expect(campaignIndex).toBeLessThan(tenantIndex);
    });
  });

  describe('Classification must not condemn a row by appearance (regression)', () => {
    // The first classifier matched loose substrings and `endsWith('-tenant')`.
    // `default-tenant` — the approved production tenant — matched, so every row it
    // owned was queued for deletion and the manifest reported zero rows to review.
    it('never classifies a row of the approved production tenant as seed data', () => {
      for (const model of ['lead', 'campaign', 'client', 'task', 'sequence'] as const) {
        const row = classifyRow(model, { id: `${model}-1`, tenantId: 'default-tenant' }, approvedEmails, approvedTenants);
        expect(row.classification).toBe('KEEP_REAL');
      }

      const tenant = classifyRow('tenant', { id: 'default-tenant' }, approvedEmails, approvedTenants);
      expect(tenant.classification).toBe('KEEP_REAL');
    });

    it('does not treat a real user as a fixture because their address opens with a fixture word', () => {
      // 'cindy@...' opened with 'ci'; 'workflow-...' opened with 'wo'.
      for (const email of ['cindy@itelestar.com', 'testa@itelestar.com', 'loan@itelestar.com']) {
        const user = classifyRow('user', { id: 'usr-x', email, tenantId: 'default-tenant' }, approvedEmails, approvedTenants);
        expect(user.classification).toBe('REVIEW_REQUIRED');
      }
    });

    it('does not condemn a real-looking tenant whose id merely ends in -tenant', () => {
      const unknown = classifyRow('tenant', { id: 'unregistered-tenant' }, approvedEmails, approvedTenants);
      expect(unknown.classification).toBe('REVIEW_REQUIRED');

      const business = classifyRow('lead', { id: 'lead-1', tenantId: 'unregistered-tenant' }, approvedEmails, approvedTenants);
      expect(business.classification).toBe('REVIEW_REQUIRED');
    });

    it('still recognises the automated suites’ own generated tenants', () => {
      const isolation = classifyRow(
        'tenant',
        { id: 't8a-a-1cbf729c-5826-4f30-9d20-842e9dcaf26c' },
        approvedEmails,
        approvedTenants
      );
      expect(isolation.classification).toBe('PURGE_SEED');

      const bullmq = classifyRow('tenant', { id: 'test-tenant-bullmq' }, approvedEmails, approvedTenants);
      expect(bullmq.classification).toBe('PURGE_SEED');
    });

    it('purges a row inside the approved tenant only when the row itself is marked demo', () => {
      const marked = classifyRow('lead', { id: 'lead-2', tenantId: 'default-tenant', isDemo: true }, approvedEmails, approvedTenants);
      expect(marked.classification).toBe('PURGE_SEED');
    });

    it('never returns PURGE_SEED for a row with no tenant association', () => {
      const orphan = classifyRow('lead', { id: 'lead-3' }, approvedEmails, approvedTenants);
      expect(orphan.classification).toBe('REVIEW_REQUIRED');
    });
  });

  describe('Manifest integrity (Sections 26, 33)', () => {
    const baseManifest = (): PurgeManifest => ({
      manifestId: 'manifest-test',
      schemaVersion: 1,
      generatedAt: '2026-08-25T00:00:00.000Z',
      productionDatabaseFingerprint: 'unit-test-db',
      approvedRosterHash: 'roster-hash',
      summary: { totalRowsScanned: 1, rowsToDeleteCount: 1, rowsToKeepCount: 0, rowsRequiringReviewCount: 0 },
      countsByModel: { lead: { total: 1, delete: 1, keep: 0, review: 0 } },
      rowsToDelete: [{ model: 'lead', id: 'lead-1', classification: 'PURGE_SEED', reason: 'demo tenant' }],
      rowsToKeep: [],
      rowsRequiringReview: [],
    });

    it('the recorded hash reproduces when the manifest is re-read from disk', () => {
      const manifest = baseManifest();
      manifest.manifestSha256 = canonicalManifestHash(manifest);

      const roundTripped: PurgeManifest = JSON.parse(JSON.stringify(manifest));
      expect(canonicalManifestHash(roundTripped)).toBe(manifest.manifestSha256);
    });

    it('a changed id, classification or count breaks the hash', () => {
      const manifest = baseManifest();
      const signature = canonicalManifestHash(manifest);

      const changedId: PurgeManifest = JSON.parse(JSON.stringify(manifest));
      changedId.rowsToDelete[0].id = 'lead-999';
      expect(canonicalManifestHash(changedId)).not.toBe(signature);

      const changedClass: PurgeManifest = JSON.parse(JSON.stringify(manifest));
      changedClass.rowsToDelete[0].classification = 'KEEP_REAL';
      expect(canonicalManifestHash(changedClass)).not.toBe(signature);

      const changedCount: PurgeManifest = JSON.parse(JSON.stringify(manifest));
      changedCount.summary.rowsToDeleteCount = 2;
      expect(canonicalManifestHash(changedCount)).not.toBe(signature);
    });
  });

  describe('Fail-closed preconditions (Section 30)', () => {
    const ENV_KEYS = ['EMAIL_GLOBAL_PAUSE', 'SEQUENCE_AUTOSEND_ENABLED', 'IMPORTS_PAUSED', 'QUEUES_PAUSED'];
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const key of ENV_KEYS) saved[key] = process.env[key];
    });

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it('refuses when no operator recovery evidence was supplied at all', () => {
      const unmet = evaluatePreconditions(null).filter((c) => !c.satisfied);
      expect(unmet.map((c) => c.name)).toContain('operator recovery evidence supplied');
    });

    it('names email pause, autosend, imports and queues among its checks', () => {
      const names = evaluatePreconditions(null).map((c) => c.name);
      expect(names).toContain('EMAIL_GLOBAL_PAUSE is true');
      expect(names).toContain('SEQUENCE_AUTOSEND_ENABLED is not true');
      expect(names).toContain('imports are blocked');
      expect(names).toContain('queues are paused');
    });

    it('treats an unset EMAIL_GLOBAL_PAUSE as unsatisfied, never as absent-so-fine', () => {
      delete process.env.EMAIL_GLOBAL_PAUSE;
      const pause = evaluatePreconditions(null).find((c) => c.name === 'EMAIL_GLOBAL_PAUSE is true');
      expect(pause!.satisfied).toBe(false);

      process.env.EMAIL_GLOBAL_PAUSE = 'true';
      const paused = evaluatePreconditions(null).find((c) => c.name === 'EMAIL_GLOBAL_PAUSE is true');
      expect(paused!.satisfied).toBe(true);
    });

    it('treats an explicitly enabled autosend as unsatisfied', () => {
      process.env.SEQUENCE_AUTOSEND_ENABLED = 'true';
      const autosend = evaluatePreconditions(null).find((c) => c.name === 'SEQUENCE_AUTOSEND_ENABLED is not true');
      expect(autosend!.satisfied).toBe(false);
    });

    it('rejects recovery evidence that names a different database', () => {
      const file = path.join(process.cwd(), `.precond-${Date.now()}.json`);
      writeFileSync(
        file,
        JSON.stringify({
          backupVerified: true,
          backupId: 'backup-1',
          backupCompletedAt: new Date().toISOString(),
          pitrEnabled: true,
          recoveryAccessVerified: true,
          databaseFingerprint: 'some-other-host:5432/some_other_db',
        })
      );
      try {
        const target = evaluatePreconditions(file).find(
          (c) => c.name === 'the evidence names the database being targeted'
        );
        expect(target!.satisfied).toBe(false);
      } finally {
        unlinkSync(file);
      }
    });

    it('rejects a backup older than the cutover window', () => {
      const file = path.join(process.cwd(), `.precond-old-${Date.now()}.json`);
      const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      writeFileSync(
        file,
        JSON.stringify({
          backupVerified: true,
          backupId: 'backup-old',
          backupCompletedAt: threeDaysAgo,
          pitrEnabled: true,
          recoveryAccessVerified: true,
        })
      );
      try {
        const fresh = evaluatePreconditions(file).find((c) => c.name.startsWith('the backup is younger'));
        expect(fresh!.satisfied).toBe(false);
      } finally {
        unlinkSync(file);
      }
    });

    it('rejects evidence that simply omits PITR rather than denying it', () => {
      const file = path.join(process.cwd(), `.precond-nopitr-${Date.now()}.json`);
      writeFileSync(
        file,
        JSON.stringify({
          backupVerified: true,
          backupId: 'backup-2',
          backupCompletedAt: new Date().toISOString(),
          recoveryAccessVerified: true,
        })
      );
      try {
        const pitr = evaluatePreconditions(file).find((c) => c.name === 'point-in-time recovery is enabled');
        expect(pitr!.satisfied).toBe(false);
      } finally {
        unlinkSync(file);
      }
    });
  });

  describe('Rehearsal targets a restored clone, not production (Sections 35, 36)', () => {
    const PROD = 'prod-host:5432/telestar_crm';
    const CLONE = 'clone-host:5432/telestar_crm_restore';

    it('refuses execution against a database the manifest was not built for', () => {
      const result = resolveTargetDatabase({
        manifestFingerprint: PROD,
        currentFingerprint: 'other-host:5432/telestar_crm',
      });
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain('TARGET DATABASE MISMATCH');
    });

    it('allows execution against exactly the database the manifest names', () => {
      const result = resolveTargetDatabase({ manifestFingerprint: PROD, currentFingerprint: PROD });
      expect(result.ok).toBe(true);
    });

    it('refuses a rehearsal that is connected to production itself', () => {
      // The defect this replaces: REHEARSE was executeMode(dryRun=true) against
      // the very instance the manifest targets.
      const result = resolveTargetDatabase({
        manifestFingerprint: PROD,
        currentFingerprint: PROD,
        cloneOf: PROD,
      });
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain('REHEARSAL REFUSED');
    });

    it('allows a rehearsal on a clone that attests to the production instance', () => {
      const result = resolveTargetDatabase({
        manifestFingerprint: PROD,
        currentFingerprint: CLONE,
        cloneOf: PROD,
      });
      expect(result.ok).toBe(true);
      expect((result as { note: string }).note).toContain(CLONE);
    });

    it('refuses a clone attestation that names a different production instance', () => {
      const result = resolveTargetDatabase({
        manifestFingerprint: PROD,
        currentFingerprint: CLONE,
        cloneOf: 'a-different-prod:5432/telestar_crm',
      });
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toContain('CLONE ATTESTATION MISMATCH');
    });
  });

  describe('Approved Roster Verification', () => {
    it('approved roster JSON exists and has valid structure with Director and Team Leads', () => {
      const rosterPath = path.join(process.cwd(), 'scripts', 'cutover', 'approved-roster.json');
      expect(existsSync(rosterPath)).toBe(true);
      const data = JSON.parse(readFileSync(rosterPath, 'utf8'));
      expect(data.approvedUsers).toBeDefined();
      expect(data.approvedUsers.length).toBeGreaterThanOrEqual(44);

      const dean = data.approvedUsers.find((u: any) => u.email === 'dean@telestar.vn');
      expect(dean).toBeDefined();
      expect(dean.role).toBe('director');

      const sonny = data.approvedUsers.find((u: any) => u.email === 'sonnynguyenofficial@gmail.com');
      expect(sonny).toBeDefined();
      expect(sonny.role).toBe('director');
    });
  });
});

/**
 * The manifest must have looked at everything before it says nothing needs review (TEL-P1-046).
 *
 * `planMode` iterated `TOPOLOGICAL_MODELS` — 29 hand-maintained names — while the schema
 * declares 68 models. The other 39 were never read, never classified, and never appeared in
 * `countsByModel`. Nothing failed; the loop simply had no entry for them.
 *
 * Measured against live production on 2026-08-25, the manifest reported
 * `totalRowsScanned: 45` and `rowsRequiringReviewCount: 0` for a database holding ~990 rows,
 * having never opened Contact (36), Account (35), ContactIntelligence (36), AuditLog (656),
 * AiCall (75), JobRun (21) or TenantAiBudgetReservation (28).
 *
 * Nothing could be deleted that was never classified, so this destroyed no data. It is worse
 * placed than that: directive section 23 makes `rowsRequiringReviewCount` the gate that blocks
 * a cutover, and the gate read zero because nothing had looked.
 */
describe('the scan covers every model, not just the deletable ones (TEL-P1-046)', () => {
  const schema = readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const schemaModels = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  const asDelegate = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

  it('the schema declares substantially more models than the delete order lists', () => {
    // If these were ever equal the test below would pass vacuously.
    expect(schemaModels.length).toBeGreaterThan(TOPOLOGICAL_MODELS.length);
  });

  it('reads the model set from the generated client rather than a literal', () => {
    const scanned = allModelDelegateNames();
    expect(scanned.length).toBe(schemaModels.length);
  });

  it('scans every model the schema declares', () => {
    const scanned = new Set(allModelDelegateNames());
    const unscanned = schemaModels.map(asDelegate).filter((m) => !scanned.has(m));
    expect(unscanned, `models the manifest would never look at: ${unscanned.join(', ')}`).toEqual([]);
  });

  it('scans the models whose absence produced the false green', () => {
    // Named individually: these are the ones measured as populated in production while the
    // manifest reported zero rows requiring review.
    const scanned = new Set(allModelDelegateNames());
    for (const model of ['contact', 'account', 'contactIntelligence', 'auditLog', 'aiCall', 'jobRun']) {
      expect(scanned.has(model), `${model} is not scanned`).toBe(true);
    }
  });

  it('keeps the delete order a strict subset of what is scanned', () => {
    // A name in the delete order that no longer exists in the schema would silently never match.
    const scanned = new Set(allModelDelegateNames());
    const orphaned = (TOPOLOGICAL_MODELS as readonly string[]).filter((m) => !scanned.has(m));
    expect(orphaned, `delete-order names with no model: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('does not claim a delete position for a model it has not ordered', () => {
    // The correctness of the split: everything is classified, only the ordered set is deletable.
    const scanned = allModelDelegateNames();
    const deletable = new Set(TOPOLOGICAL_MODELS as readonly string[]);
    const scannedButNotDeletable = scanned.filter((m) => !deletable.has(m));
    expect(scannedButNotDeletable.length).toBeGreaterThan(0);
    expect(deletable.size).toBeLessThan(scanned.length);
  });
});
