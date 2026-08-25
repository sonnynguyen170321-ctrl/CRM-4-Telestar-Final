import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalManifestHash,
  classifyRow,
  PurgeManifest,
  sha256,
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
