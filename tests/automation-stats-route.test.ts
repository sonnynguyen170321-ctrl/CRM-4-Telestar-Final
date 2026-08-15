import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeUserFindUnique } from './helpers/mockDbUser';
import type { SessionUser } from '@/lib/auth';

/**
 * The `/automation` operator payload (Plan 1 §A6).
 *
 * Two properties are load-bearing here and neither is visible from the UI:
 *
 * 1. The waiting list is scoped through `getLeadWhereScope`. Without it, this page would be a
 *    way for an SDR to enumerate a colleague's prospects — the mailbox half of the route is
 *    already pod-scoped, and the cadence half must match it.
 * 2. `sequence_deferred` is in the activity filter. A deferral that exists in the database but
 *    is filtered out of the only page an operator watches is, in practice, not recorded at all.
 */

const mockUserFindMany = vi.fn();
const mockLeadCount = vi.fn().mockResolvedValue(3);
const mockTaskCount = vi.fn().mockResolvedValue(2);
const mockTaskFindMany = vi.fn().mockResolvedValue([]);
const mockAccountCount = vi.fn().mockResolvedValue(1);
const mockAccountFindMany = vi.fn().mockResolvedValue([]);
const mockActivityFindMany = vi.fn().mockResolvedValue([]);
const mockEnrollmentFindMany = vi.fn().mockResolvedValue([]);

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const mockUserFindUnique = makeUserFindUnique([
  { id: 'u-dir', role: 'director', tenantId: 'tenant-1' },
  { id: 'u-sdr', role: 'sdr', tenantId: 'tenant-1' },
]);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      findUnique: (args: { where?: { id?: string } }) => mockUserFindUnique(args),
    },
    lead: { count: (...a: unknown[]) => mockLeadCount(...a) },
    task: {
      count: (...a: unknown[]) => mockTaskCount(...a),
      findMany: (...a: unknown[]) => mockTaskFindMany(...a),
    },
    emailAccount: {
      count: (...a: unknown[]) => mockAccountCount(...a),
      findMany: (...a: unknown[]) => mockAccountFindMany(...a),
    },
    activity: { findMany: (...a: unknown[]) => mockActivityFindMany(...a) },
    sequenceEnrollment: { findMany: (...a: unknown[]) => mockEnrollmentFindMany(...a) },
    campaignMember: { findMany: vi.fn().mockResolvedValue([]) },
  },
  tenantStorage: { run: (_: unknown, fn: () => unknown) => fn() },
}));

const { auth } = await import('@/auth');
const { GET } = await import('@/app/api/automation/stats/route');

function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u-dir',
    email: 'dir@telestar.test',
    firstName: 'Dana',
    lastName: 'Director',
    role: 'director',
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function enrollmentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'enr-1',
    status: 'active',
    currentStep: 2,
    nextActionAt: new Date('2099-01-01T09:00:00.000Z'),
    pausedReason: null,
    sequenceId: 'seq-1',
    lead: {
      id: 'lead-1',
      firstName: 'Pat',
      lastName: 'Prospect',
      company: 'Acme',
      assignedToId: 'u-sdr',
    },
    sequence: { id: 'seq-1', name: 'Cold Outbound' },
    ...over,
  };
}

const request = new Request('http://localhost/api/automation/stats') as never;

describe('GET /api/automation/stats — operator reasons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeadCount.mockResolvedValue(3);
    mockTaskCount.mockResolvedValue(2);
    mockTaskFindMany.mockResolvedValue([]);
    mockAccountCount.mockResolvedValue(1);
    mockAccountFindMany.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([]);
    mockEnrollmentFindMany.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([]);
    vi.mocked(auth).mockResolvedValue({ user: sessionUser() } as never);
  });

  it('explains every in-flight cadence in words, with no engine vocabulary', async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollmentRow()]);
    mockAccountFindMany.mockResolvedValue([
      {
        userId: 'u-sdr',
        isActive: true,
        sendPausedAt: null,
        dailyCap: 100,
        dailySendCount: 1,
        dailySendDate: new Date(),
        healthLevel: 'healthy',
      },
    ]);

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.waiting).toHaveLength(1);
    expect(body.waiting[0]).toMatchObject({
      enrollmentId: 'enr-1',
      reasonCode: 'waiting_for_next_step',
      reasonLabel: 'Waiting for the next step',
      needsAttention: false,
    });
    expect(`${body.waiting[0].reasonLabel} ${body.waiting[0].detail}`.toLowerCase()).not.toMatch(
      /queue|job|worker|defer|bullmq/
    );
  });

  it('counts the cadences a human has to unblock', async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollmentRow(), enrollmentRow({ id: 'enr-2' })]);
    // No mailbox rows: both prospects are blocked on a disconnected mailbox.
    mockAccountFindMany.mockResolvedValue([]);

    const body = await (await GET(request)).json();

    expect(body.metrics.needsAttention).toBe(2);
    expect(body.waiting.every((w: { reasonCode: string }) => w.reasonCode === 'mailbox_unavailable')).toBe(
      true
    );
  });

  it('scopes the waiting list to the leads the viewer may see', async () => {
    // An SDR: `getLeadWhereScope` resolves to their own assigned leads.
    vi.mocked(auth).mockResolvedValue({ user: sessionUser({ id: 'u-sdr', role: 'sdr' }) } as never);

    await GET(request);

    expect(mockEnrollmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lead: expect.objectContaining({ assignedToId: { in: ['u-sdr'] } }),
        }),
      })
    );
  });

  it('includes deferrals in the activity feed', async () => {
    await GET(request);

    const [[activityArgs]] = mockActivityFindMany.mock.calls as [[{ where: { type: { in: string[] } } }]];
    expect(activityArgs.where.type.in).toContain('sequence_deferred');
  });

  it('asks for the current step task, not every pending task on the lead', async () => {
    mockEnrollmentFindMany.mockResolvedValue([enrollmentRow()]);

    await GET(request);

    const [[taskArgs]] = mockTaskFindMany.mock.calls as [[{ where: Record<string, unknown> }]];
    expect(taskArgs.where).toMatchObject({ status: 'pending', sequenceId: { not: null } });
    expect(taskArgs.where.leadId).toEqual({ in: ['lead-1'] });
  });
});
