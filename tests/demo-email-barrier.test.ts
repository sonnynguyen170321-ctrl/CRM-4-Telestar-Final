import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDemoTenant, effectiveDryRun, DEMO_TENANT_ID } from '@/lib/emailSafety';

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: () => Promise.resolve('j'),
  enqueueImmediate: () => Promise.resolve('j'),
  enqueueReschedule: () => Promise.resolve('j'),
  ensureJob: () => Promise.resolve('j'),
  removeJob: () => Promise.resolve(true),
}));

describe('TEL-P1-003: Demo Tenant Live Email Barrier at Transport Boundary', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    process.env.SEQUENCE_AUTOSEND_ENABLED = 'true';
    process.env.LIVE_EMAIL_CANARY_MODE = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('effectiveDryRun tenant invariance', () => {
    it('always forces dryRun=true for demo-telestar even when EMAIL_SEND_DRY_RUN="false"', () => {
      expect(process.env.EMAIL_SEND_DRY_RUN).toBe('false');
      expect(effectiveDryRun(DEMO_TENANT_ID)).toBe(true);
      expect(effectiveDryRun('demo-telestar')).toBe(true);
      expect(effectiveDryRun('demo-tenant')).toBe(true);
      expect(effectiveDryRun('demo-acme')).toBe(true);
    });

    it('returns false for production non-demo tenant when EMAIL_SEND_DRY_RUN="false"', () => {
      expect(process.env.EMAIL_SEND_DRY_RUN).toBe('false');
      expect(effectiveDryRun('prod-tenant-123')).toBe(false);
      expect(effectiveDryRun('telestar-production')).toBe(false);
    });

    it('isDemoTenant identifies all demo-prefixed tenant identities', () => {
      expect(isDemoTenant('demo-telestar')).toBe(true);
      expect(isDemoTenant('DEMO-TELESTAR')).toBe(true);
      expect(isDemoTenant('demo-custom-org')).toBe(true);
      expect(isDemoTenant('client-production')).toBe(false);
      expect(isDemoTenant(null)).toBe(false);
      expect(isDemoTenant(undefined)).toBe(false);
    });
  });
});
