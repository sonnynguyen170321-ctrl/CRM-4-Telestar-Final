import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
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
