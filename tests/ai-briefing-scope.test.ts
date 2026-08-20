import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { SessionUser } from '@/lib/auth';

/**
 * `GET /api/ai/briefing` — the scope-shape regression.
 *
 * `Task` and `Activity` own a `userId`; `Lead` owns an `assignedToId`. One scope object was
 * spread into all of them, so every lead query in the morning briefing was invalid:
 *
 *     Invalid `prisma.lead.findMany()` invocation:
 *     Unknown argument `userId`. Available options are marked with ?.
 *
 * Prisma rejects that outright, so the endpoint answered 500 for every role except director —
 * director being the one role with no filter at all, and therefore the only one that worked.
 *
 * It stayed hidden because `components/AiAssistant.tsx` swallows a failed briefing with
 * `.catch(() => {})`. The only symptom was a morning briefing that silently never appeared,
 * which is indistinguishable from "there was nothing to report".
 */

const requireAuthMock = vi.fn();
const taskCount = vi.fn();
const taskFindMany = vi.fn();
const leadCount = vi.fn();
const leadFindMany = vi.fn();
const userFindMany = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: () => requireAuthMock(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { count: (...a: unknown[]) => taskCount(...a), findMany: (...a: unknown[]) => taskFindMany(...a) },
    lead: { count: (...a: unknown[]) => leadCount(...a), findMany: (...a: unknown[]) => leadFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    activity: { count: vi.fn(), findMany: vi.fn() },
  },
}));

const { GET } = await import('@/app/api/ai/briefing/route');

/** Every field name the Lead model does not have. Spreading a task scope introduces one. */
const LEAD_FORBIDDEN_KEYS = ['userId'];

function asRole(role: SessionUser['role'], id = 'u-1'): SessionUser {
  return { id, tenantId: 't-1', role, firstName: 'A', lastName: 'B', email: 'a@b.test' } as SessionUser;
}

function get(): NextRequest {
  return new NextRequest('http://localhost/api/ai/briefing?type=morning');
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindMany.mockResolvedValue([{ id: 'u-report-1' }]);
  taskCount.mockResolvedValue(0);
  taskFindMany.mockResolvedValue([]);
  leadCount.mockResolvedValue(0);
  leadFindMany.mockResolvedValue([]);
});

describe('lead queries are scoped by assignedToId, never userId', () => {
  const roles: SessionUser['role'][] = ['sdr', 'leadgen', 'team_lead', 'floor_manager'];

  for (const role of roles) {
    it(`${role} gets a valid lead filter`, async () => {
      requireAuthMock.mockResolvedValue(asRole(role));

      const res = await GET(get());
      expect(res.status).toBe(200);

      const leadWheres = [
        ...leadCount.mock.calls.map((call) => (call[0] as { where: Record<string, unknown> }).where),
        ...leadFindMany.mock.calls.map((call) => (call[0] as { where: Record<string, unknown> }).where),
      ];

      expect(leadWheres.length).toBeGreaterThan(0);
      for (const where of leadWheres) {
        for (const forbidden of LEAD_FORBIDDEN_KEYS) {
          expect(where, `lead query carries ${forbidden}`).not.toHaveProperty(forbidden);
        }
        expect(where).toHaveProperty('assignedToId');
      }
    });
  }

  it('scopes an SDR to themselves and a team lead to their reports', async () => {
    requireAuthMock.mockResolvedValue(asRole('sdr', 'u-sdr'));
    await GET(get());
    expect((leadCount.mock.calls[0][0] as { where: { assignedToId: { in: string[] } } }).where.assignedToId.in).toEqual([
      'u-sdr',
    ]);

    vi.clearAllMocks();
    userFindMany.mockResolvedValue([{ id: 'u-report-1' }]);
    taskCount.mockResolvedValue(0);
    taskFindMany.mockResolvedValue([]);
    leadCount.mockResolvedValue(0);
    leadFindMany.mockResolvedValue([]);

    requireAuthMock.mockResolvedValue(asRole('team_lead', 'u-tl'));
    await GET(get());
    expect((leadCount.mock.calls[0][0] as { where: { assignedToId: { in: string[] } } }).where.assignedToId.in).toEqual([
      'u-tl',
      'u-report-1',
    ]);
  });

  it('keeps userId on task queries, where it is the correct column', async () => {
    requireAuthMock.mockResolvedValue(asRole('sdr', 'u-sdr'));
    await GET(get());

    const taskWhere = (taskCount.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(taskWhere).toHaveProperty('userId');
    expect(taskWhere).not.toHaveProperty('assignedToId');
  });

  it('applies no filter for a director, who sees everything', async () => {
    requireAuthMock.mockResolvedValue(asRole('director'));
    await GET(get());

    const where = (leadCount.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty('assignedToId');
    expect(where).not.toHaveProperty('userId');
  });
});

describe('authentication', () => {
  it('refuses an unauthenticated request', async () => {
    requireAuthMock.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await GET(get());

    expect(res.status).toBe(401);
    expect(leadCount).not.toHaveBeenCalled();
  });
});
