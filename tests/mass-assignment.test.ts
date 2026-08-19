import { describe, it, expect } from 'vitest';
import {
  createLeadSchema,
  updateLeadSchema,
  createCampaignSchema,
  updateCampaignSchema,
  createClientSchema,
  updateClientSchema,
  createSequenceSchema,
  updateSequenceSchema,
  createUserSchema,
  updateUserSchema,
  createOpportunitySchema,
  updateOpportunitySchema,
} from '@/lib/validation/schemas';

describe('SEC-003: Mass Assignment Protection & Schema Hardening', () => {
  describe('Lead Schemas', () => {
    it('strips injected tenantId, id, and system timestamps on lead creation', () => {
      const maliciousPayload = {
        firstName: 'Eve',
        lastName: 'Attacker',
        company: 'Evil Corp',
        email: 'eve@evil.com',
        campaignId: 'camp-123',
        tenantId: 'victim-tenant',
        id: 'injected-id',
        createdAt: '1970-01-01T00:00:00Z',
        role: 'director',
      };

      const parsed = createLeadSchema.parse(maliciousPayload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed).not.toHaveProperty('id');
      expect(parsed).not.toHaveProperty('createdAt');
      expect(parsed).not.toHaveProperty('role');
      expect(parsed.firstName).toBe('Eve');
    });

    it('strips injected tenantId and id on lead update', () => {
      const maliciousPayload = {
        title: 'VP Sales',
        tenantId: 'victim-tenant',
        id: 'injected-id',
      };

      const parsed = updateLeadSchema.parse(maliciousPayload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed).not.toHaveProperty('id');
      expect(parsed.title).toBe('VP Sales');
    });
  });

  describe('User Schemas', () => {
    it('strips injected tenantId on user creation', () => {
      const maliciousPayload = {
        email: 'rep@company.com',
        password: 'Password123!',
        firstName: 'John',
        lastName: 'Doe',
        role: 'sdr',
        tenantId: 'super-tenant',
      };

      const parsed = createUserSchema.parse(maliciousPayload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed.email).toBe('rep@company.com');
    });

    it('strips injected tenantId and role escalation on standard user update', () => {
      const maliciousPayload = {
        firstName: 'Jane',
        tenantId: 'foreign-tenant',
      };

      const parsed = updateUserSchema.parse(maliciousPayload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed.firstName).toBe('Jane');
    });
  });

  describe('Campaign & Client Schemas', () => {
    it('strips tenantId from campaign creation', () => {
      const payload = {
        name: 'Q3 Enterprise',
        clientId: 'client-1',
        startDate: '2026-09-01T00:00:00Z',
        tenantId: 'foreign-tenant',
      };

      const parsed = createCampaignSchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
    });

    it('strips tenantId from campaign update', () => {
      const payload = {
        name: 'Q3 Enterprise Renamed',
        tenantId: 'foreign-tenant',
      };

      const parsed = updateCampaignSchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed.name).toBe('Q3 Enterprise Renamed');
    });

    it('strips tenantId from client creation', () => {
      const payload = {
        name: 'Acme Corp',
        industry: 'Software',
        contactName: 'Alice',
        contactEmail: 'alice@acme.com',
        tenantId: 'foreign-tenant',
      };

      const parsed = createClientSchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
    });

    it('strips tenantId from client update', () => {
      const payload = {
        industry: 'Technology',
        tenantId: 'foreign-tenant',
      };

      const parsed = updateClientSchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed.industry).toBe('Technology');
    });
  });

  describe('Opportunity Schemas', () => {
    it('strips tenantId, id, and computed win probabilities on opportunity creation', () => {
      const payload = {
        title: 'Acme Renewal Deal',
        company: 'Acme Corp',
        clientId: 'client-1',
        campaignId: 'camp-1',
        value: 50000,
        leadId: 'lead-1',
        tenantId: 'foreign-tenant',
        id: 'opp-injected',
      };

      const parsed = createOpportunitySchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed).not.toHaveProperty('id');
      expect(parsed.value).toBe(50000);
      expect(parsed.title).toBe('Acme Renewal Deal');
    });

    it('strips tenantId and id on opportunity update', () => {
      const payload = {
        title: 'Updated Deal Title',
        tenantId: 'foreign-tenant',
        id: 'opp-injected-id',
      };

      const parsed = updateOpportunitySchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed).not.toHaveProperty('id');
      expect(parsed.title).toBe('Updated Deal Title');
    });
  });

  describe('Sequence Schemas', () => {
    it('strips tenantId from sequence creation', () => {
      const payload = {
        name: 'Cold Outreach v2',
        campaignId: 'camp-1',
        tenantId: 'foreign-tenant',
      };

      const parsed = createSequenceSchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
    });

    it('strips tenantId from sequence update', () => {
      const payload = {
        name: 'Cold Outreach v3',
        tenantId: 'foreign-tenant',
      };

      const parsed = updateSequenceSchema.parse(payload);
      expect(parsed).not.toHaveProperty('tenantId');
      expect(parsed.name).toBe('Cold Outreach v3');
    });
  });
});
