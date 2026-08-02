import { vi, describe, it, expect } from 'vitest';

// Mock @/auth to avoid loading next-auth inside Vitest tests
vi.mock('@/auth', () => ({
  auth: vi.fn(() => Promise.resolve(null)),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import {
  canImportExport,
  isLeadgenManager,
  isLeadgenUser,
  getLeadgenScope,
  getVisibleUserIds,
  getLeadWhereScope,
  canAccessLead,
  buildRoleScope,
  type SessionUser,
} from '@/lib/auth';
import { role as roleEnum } from '@/lib/validation/schemas';

describe('Role Personas & Journey Scope Hardening', () => {
  describe('1. Role Schema & Permission Coverage', () => {
    it('validates all 6 production roles in Zod schema', () => {
      const validRoles = ['director', 'floor_manager', 'team_lead', 'sdr', 'leadgen_manager', 'leadgen'];
      validRoles.forEach((r) => {
        const result = roleEnum.safeParse(r);
        expect(result.success).toBe(true);
      });
    });

    it('enforces correct import/export permissions per role', () => {
      expect(canImportExport('director')).toBe(true);
      expect(canImportExport('floor_manager')).toBe(true);
      expect(canImportExport('leadgen_manager')).toBe(true);
      expect(canImportExport('leadgen')).toBe(true);
      expect(canImportExport('sdr')).toBe(true);
      expect(canImportExport('team_lead')).toBe(false);
    });

    it('identifies leadgen users vs leadgen managers', () => {
      expect(isLeadgenUser('leadgen')).toBe(true);
      expect(isLeadgenUser('leadgen_manager')).toBe(true);
      expect(isLeadgenUser('sdr')).toBe(false);

      expect(isLeadgenManager('leadgen_manager')).toBe(true);
      expect(isLeadgenManager('director')).toBe(true);
      expect(isLeadgenManager('floor_manager')).toBe(true);
      expect(isLeadgenManager('sdr')).toBe(false);
    });
  });

  describe('2. Director Persona Journey', () => {
    const directorUser: SessionUser = {
      id: 'director-001',
      email: 'director@telestar.io',
      firstName: 'Dean',
      lastName: 'Director',
      role: 'director',
      isManager: true,
      tenantId: 'default-tenant',
    };

    it('has unrestricted visible user IDs (null = all)', async () => {
      const visibleIds = await getVisibleUserIds(directorUser);
      expect(visibleIds).toBeNull();
    });

    it('has global visibility over all leads across all campaigns', async () => {
      const leadScope = await getLeadWhereScope(directorUser);
      expect(leadScope).toEqual({});
    });

    it('can access any lead across any campaign or SDR assignment', async () => {
      const lead = { assignedToId: 'sdr-999', campaignId: 'camp-999' };
      const canAccess = await canAccessLead(directorUser, lead);
      expect(canAccess).toBe(true);
    });
  });

  describe('3. SDR Persona Journey', () => {
    const sdrUser: SessionUser = {
      id: 'sdr-001',
      email: 'sdr@telestar.io',
      firstName: 'Sam',
      lastName: 'SDR',
      role: 'sdr',
      isManager: false,
      tenantId: 'default-tenant',
    };

    it('scopes visible users strictly to own user ID', async () => {
      const visibleIds = await getVisibleUserIds(sdrUser);
      expect(visibleIds).toEqual(['sdr-001']);
    });

    it('restricts lead query scope strictly to assigned leads', async () => {
      const leadScope = await getLeadWhereScope(sdrUser);
      expect(leadScope).toEqual({ assignedToId: { in: ['sdr-001'] } });
    });

    it('allows access to own assigned leads, denies other SDRs leads', async () => {
      const ownLead = { assignedToId: 'sdr-001', campaignId: 'camp-1' };
      const otherLead = { assignedToId: 'sdr-002', campaignId: 'camp-1' };

      expect(await canAccessLead(sdrUser, ownLead)).toBe(true);
      expect(await canAccessLead(sdrUser, otherLead)).toBe(false);
    });

    it('denies SDR access to unassigned leads in a shared campaign', async () => {
      const unassignedLead = { assignedToId: null, campaignId: 'camp-1' };
      expect(await canAccessLead(sdrUser, unassignedLead)).toBe(false);
    });
  });

  describe('4. Leadgen Manager Persona Journey', () => {
    const leadgenMgrUser: SessionUser = {
      id: 'leadgen-mgr-001',
      email: 'leadgen.mgr@telestar.io',
      firstName: 'Lina',
      lastName: 'Leadgen',
      role: 'leadgen_manager',
      isManager: true,
      tenantId: 'default-tenant',
    };

    it('returns manager kind scope over entire lead pool and routing', async () => {
      const scope = await getLeadgenScope(leadgenMgrUser);
      expect(scope).toEqual({ kind: 'manager' });
    });

    it('has global org-wide lead scope', async () => {
      const leadScope = await getLeadWhereScope(leadgenMgrUser);
      expect(leadScope).toEqual({});
    });
  });

  describe('5. Floor Manager Persona Journey', () => {
    const floorMgrUser: SessionUser = {
      id: 'floor-mgr-001',
      email: 'fm@telestar.io',
      firstName: 'Frank',
      lastName: 'Manager',
      role: 'floor_manager',
      isManager: true,
      tenantId: 'default-tenant',
    };

    it('has role scope allowing overview of team operations', () => {
      const scope = buildRoleScope(floorMgrUser);
      expect(scope).toEqual({});
    });

    it('has leadgen manager privileges for data ops', async () => {
      const scope = await getLeadgenScope(floorMgrUser);
      expect(scope).toEqual({ kind: 'manager' });
    });
  });
});
