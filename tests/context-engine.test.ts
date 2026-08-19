import { describe, it, expect } from 'vitest';
import {
  assembleContext,
  DEFAULT_TOKEN_BUDGET,
} from '@/lib/ai/contextEngine';
import type { SessionUser } from '@/lib/auth';

const testUser: SessionUser = {
  id: 'user-sdr-1',
  email: 'sdr1@telestar.test',
  role: 'sdr',
  tenantId: 'tenant-test-ctx',
  firstName: 'Sam',
  lastName: 'SDR',
};

describe('Phase 2: Context Engine 2.0 & Deterministic Truth', () => {
  it('enforces token budget limits and default allocations', () => {
    expect(DEFAULT_TOKEN_BUDGET.maxTotalTokens).toBe(4000);
    expect(DEFAULT_TOKEN_BUDGET.p0CoreBudget).toBe(1000);
    expect(DEFAULT_TOKEN_BUDGET.p1RecentEventsBudget).toBe(1200);
  });

  it('assembles compact deterministic context without dumping raw databases', async () => {
    const assembled = await assembleContext({
      sessionUser: testUser,
      question: 'What should I do today?',
    });

    expect(assembled.estimatedTokens).toBeLessThan(1000);
    expect(assembled.systemContextPrompt).toContain('=== TELESTAR CONTEXT 2.0 (DETERMINISTIC TRUTH) ===');
    expect(assembled.systemContextPrompt).toContain('Role: sdr');
    expect(assembled.systemContextPrompt).toContain('Tenant: tenant-test-ctx');
  });

  it('structures P0 facts with strict multi-tenant boundary', async () => {
    const assembled = await assembleContext({
      sessionUser: testUser,
    });

    expect(assembled.p0Facts.tenantId).toBe('tenant-test-ctx');
    expect(assembled.p0Facts.role).toBe('sdr');
  });
});
