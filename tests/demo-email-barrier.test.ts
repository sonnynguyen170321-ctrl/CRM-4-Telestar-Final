import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDemoTenant, effectiveDryRun, DEMO_TENANT_ID } from '@/lib/emailSafety';

const mockSend = vi.fn().mockResolvedValue('provider-msg-123');
const mockFromAccount = vi.fn().mockResolvedValue({ send: mockSend });

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: (...args: unknown[]) => mockFromAccount(...args),
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: () => Promise.resolve('j'),
  enqueueImmediate: () => Promise.resolve('j'),
  enqueueReschedule: () => Promise.resolve('j'),
  ensureJob: () => Promise.resolve('j'),
  removeJob: () => Promise.resolve(true),
}));

const mockOutboundUpdate = vi.fn().mockResolvedValue({});
const mockActivityCreate = vi.fn().mockResolvedValue({});
const mockLeadUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(1),
    outboundMessage: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: (...args: unknown[]) => mockOutboundUpdate(...args),
    },
    activity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    lead: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
    suppressionEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    emailAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'acc-1',
        email: 'rep@telestar.demo',
        provider: 'smtp',
        status: 'active',
        isActive: true,
        sendPausedAt: null,
        sendPauseReason: null,
        healthLevel: null,
        dailySendLimit: 100,
        sentTodayCount: 0,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
  /**
   * `atomicReserveQuota` routes its raw UPDATE through this so the statement carries a tenant
   * context under RLS — raw SQL is outside the tenant extension. The stand-in hands the
   * callback a client whose `$executeRaw` reports one row reserved, which is what this suite
   * needs: the barrier under test is the transport, and a send that never got past quota would
   * pass vacuously.
   */
  withTenantRaw: (_tenantId: string, run: (db: unknown) => unknown) =>
    run({ $executeRaw: vi.fn().mockResolvedValue(1) }),
}));

const { prisma } = await import('@/lib/prisma');
const { handleEmailSend } = await import('@/workers/email');

describe('TEL-P1-003 / TEL-P2-005: Demo Tenant Live Email Barrier at Transport Boundary', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('TEL-P2-005: Worker Execution Demo Transport Interception', () => {
    it('executes handleEmailSend for demo tenant with EMAIL_SEND_DRY_RUN="false" and guarantees EmailService.send call count is 0', async () => {
      expect(process.env.EMAIL_SEND_DRY_RUN).toBe('false');

      vi.mocked(prisma.outboundMessage.findUnique).mockResolvedValueOnce({
        id: 'msg-demo-1',
        tenantId: 'demo-telestar',
        status: 'pending',
        to: 'prospect@external.com',
        subject: 'Demo Pitch',
        body: 'Demo Body',
        leadId: 'lead-demo-1',
        providerMessageId: null,
        sentAt: null,
        lead: { campaignId: 'camp-demo-1', assignedToId: 'user-demo-1' },
      } as never);

      const result = await handleEmailSend({
        outboundMessageId: 'msg-demo-1',
        accountId: 'acc-1',
        to: 'prospect@external.com',
        subject: 'Demo Pitch',
        body: 'Demo Body',
        leadId: 'lead-demo-1',
      });

      // Assert handler succeeded as dry-run
      expect(result).toEqual({
        success: true,
        dryRun: true,
        outboundMessageId: 'msg-demo-1',
        providerMessageId: 'dry-run-msg-demo-1',
      });

      // Assert hard barrier: real EmailService.send was NEVER called!
      expect(mockSend).toHaveBeenCalledTimes(0);
      expect(mockFromAccount).toHaveBeenCalledTimes(0);

      // Assert dry-run activity was recorded
      expect(mockActivityCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('[DRY RUN]'),
          }),
        })
      );
    });
  });
});
