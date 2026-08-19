import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
const mockSuppressionFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contact: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    suppressionEntry: {
      findMany: (...args: unknown[]) => mockSuppressionFindMany(...args),
    },
  },
  tenantStorage: {
    run: (_ctx: unknown, fn: () => unknown) => fn(),
  },
}));

const { evaluateContactReuse } = await import('@/lib/ai/relationshipGraph');

describe('Phase 4: Relationship Capital Graph & Conflict-Aware Reuse', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockSuppressionFindMany.mockReset();
    mockSuppressionFindMany.mockResolvedValue([]);
  });

  it('correctly reports unproven status when contact is not in database', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await evaluateContactReuse('tenant-test', 'non-existent-contact-id', 'camp-1');
    expect(res.eligible).toBe(false);
    expect(res.blockers).toContain('Contact not found in database');
  });

  it('blocks reuse when contact is suppressed or opted out', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'contact-1',
      email: 'test@contact.com',
      intelligence: { reuseStatus: 'do_not_contact' },
    });
    mockSuppressionFindMany.mockResolvedValue([{ id: 'sup-1', reason: 'unsubscribe' }]);

    const res = await evaluateContactReuse('tenant-test', 'contact-1', 'camp-1');
    expect(res.eligible).toBe(false);
    expect(res.classification).toBe('RESTRICTED');
    expect(res.blockers).toContain('Contact is suppressed or opted out.');
  });

  it('blocks reuse when contact is under active outreach cooldown', async () => {
    const futureDate = new Date(Date.now() + 86400000 * 14); // 14 days cooldown
    mockFindUnique.mockResolvedValue({
      id: 'contact-2',
      suppressions: [],
      intelligence: {
        reuseStatus: 'cooldown',
        cooldownUntil: futureDate,
      },
    });

    const res = await evaluateContactReuse('tenant-test', 'contact-2', 'camp-1');
    expect(res.eligible).toBe(false);
    expect(res.classification).toBe('RESTRICTED');
    expect(res.blockers[0]).toContain('Under outreach cooldown');
  });

  it('approves reuse and identifies PROVEN classification for high-scoring relationships', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'contact-3',
      suppressions: [],
      intelligence: {
        reuseStatus: 'eligible',
        qualityClass: 'proven',
        commercialScore: 92,
      },
    });

    const res = await evaluateContactReuse('tenant-test', 'contact-3', 'camp-1');
    expect(res.eligible).toBe(true);
    expect(res.classification).toBe('PROVEN');
    expect(res.recommendedAngle).toContain('past positive dialogue');
  });
});
