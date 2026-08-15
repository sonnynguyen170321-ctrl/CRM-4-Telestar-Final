import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Role surfaces (Revenue AI Phase 9).
 *
 * Three properties, and all three are the product rather than the implementation:
 *
 * 1. **A role reads its own responsibility.** The surface is chosen server-side from the session.
 * 2. **Healthy automation is silent.** With nothing wrong, every group is empty and says so.
 * 3. **No engineering vocabulary reaches a user.** No queue, worker, lease, work order or
 *    operating-state enum in any label a person reads.
 *
 * The third is asserted mechanically over every string in every built surface, because it is the
 * one that decays: a future contributor adding a group titled "blocked work orders" would be
 * making a locally reasonable choice and quietly breaking the product's promise.
 */

// ─── a permissive prisma stand-in ───
// Every surface is a composition of reads. What the tests below check is the *shape* of what is
// produced from them, so the stub answers every model identically and each test overrides only
// the rows its own assertion depends on.
const rows = {
  lead: [] as unknown[],
  task: [] as unknown[],
  activityGroup: [] as unknown[],
  user: [{ id: 'sdr-1', role: 'sdr', managerId: 'tl-1' }] as unknown[],
};

const emptyModel = {
  findMany: vi.fn(async () => []),
  findFirst: vi.fn(async () => null),
  findUnique: vi.fn(async () => null),
  count: vi.fn(async () => 0),
  groupBy: vi.fn(async () => []),
  aggregate: vi.fn(async () => ({})),
};

vi.mock('@/lib/prisma', () => {
  const model = (name: string) => ({
    findMany: vi.fn(async () => {
      if (name === 'lead') return rows.lead;
      if (name === 'task') return rows.task;
      if (name === 'user') return rows.user;
      return [];
    }),
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    count: vi.fn(async () => 0),
    groupBy: vi.fn(async () => (name === 'activity' ? rows.activityGroup : [])),
    aggregate: vi.fn(async () => ({})),
  });

  return {
    prisma: new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => {
        if (!(prop in target)) target[prop] = model(prop);
        return target[prop];
      },
    }),
  };
});

vi.mock('@/lib/email-health/queries', () => ({
  getOverview: vi.fn(async () => ({
    totals: { inboxes: 4, active: 4, paused: 0, healthy: 4, watch: 0, atRisk: 0, critical: 0 },
    today: { sent: 100, capacity: 400, usagePct: 25 },
    sevenDay: { sent: 700, hardBounceRate: 0, softBounceRate: 0, replyRate: 0.04, spamSignalRate: 0, suppressionGrowth: 0 },
    openAlerts: { total: 0, critical: 0, warning: 0, info: 0 },
  })),
  getCampaignHealth: vi.fn(async () => []),
}));

vi.mock('@/lib/leadgen/metrics', () => ({
  getLeadgenMetrics: vi.fn(async () => ({
    importedWeek: 100, qualifiedWeek: 80, disqualifiedWeek: 5, totalPool: 500,
    duplicateRate: 2, emailValidRate: 96, assignedToCampaign: 300, assignedToSdr: 250,
    qualifiedBySource: [], qualifiedByMember: [], requirementProgress: [], avgDaysToQualification: 1.2,
  })),
}));

vi.mock('@/lib/reporting/aiSpend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reporting/aiSpend')>('@/lib/reporting/aiSpend');
  return {
    ...actual,
    getAiSpend: vi.fn(async () => ({
      windowStart: new Date(), windowEnd: new Date(), totalUsd: 0, totalCalls: 0,
      failedCalls: 0, searchCredits: 0, byCampaign: [], unattributedUsd: 0,
    })),
  };
});

const { buildRoleSurface, surfaceKeyForRole } = await import('@/lib/console/surfaces');
const { lateHandoffs, reengagementGaps, stalledConversations } = await import('@/lib/console/surfaces/shared');

const emptyConsole = {
  scope: 'own' as const,
  buckets: [],
  approvals: [],
  blocked: [],
  timeline: [],
  totals: { aiManaged: 0, humanOwned: 0, needsAttention: 0, blocked: 0 },
};

const sessionUser = (role: string) =>
  ({ id: `u-${role}`, role, tenantId: 't1', email: `${role}@telestar.test` }) as never;

const NOW = new Date('2026-08-13T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  rows.lead = [];
  rows.task = [];
  rows.activityGroup = [];
  emptyModel.findMany.mockClear();
});

describe('a role reads the surface its responsibility implies', () => {
  it('maps every CRM role to exactly one surface', () => {
    expect(surfaceKeyForRole('sdr')).toBe('sdr');
    expect(surfaceKeyForRole('team_lead')).toBe('team_lead');
    expect(surfaceKeyForRole('floor_manager')).toBe('floor_manager');
    expect(surfaceKeyForRole('director')).toBe('director');
    // Two leadgen roles, one responsibility.
    expect(surfaceKeyForRole('leadgen_manager')).toBe('leadgen_manager');
    expect(surfaceKeyForRole('leadgen')).toBe('leadgen_manager');
  });

  it('falls back to the SDR surface rather than showing a manager view to an unknown role', () => {
    // Failing open here would mean a role nobody has classified yet reads a Director's cost data.
    expect(surfaceKeyForRole('some_future_role')).toBe('sdr');
  });

  it.each([
    ['sdr', 'sdr'],
    ['team_lead', 'team_lead'],
    ['floor_manager', 'floor_manager'],
    ['leadgen_manager', 'leadgen_manager'],
    ['director', 'director'],
  ])('builds the %s surface for that role', async (role, expected) => {
    const surface = await buildRoleSurface(sessionUser(role), emptyConsole, NOW);
    expect(surface.key).toBe(expected);
    expect(surface.metrics.length).toBeGreaterThan(0);
    expect(surface.groups.length).toBeGreaterThan(0);
    expect(surface.sources.length).toBeGreaterThan(0);
  });
});

describe('healthy automation stays quiet', () => {
  it.each(['sdr', 'team_lead', 'floor_manager', 'leadgen_manager', 'director'])(
    'the %s surface lists no rows when nothing is wrong, and every group explains why',
    async (role) => {
      const surface = await buildRoleSurface(sessionUser(role), emptyConsole, NOW);

      for (const group of surface.groups) {
        expect(group.items).toHaveLength(0);
        // The healthy message is the point: an empty table teaches a reader nothing, and a reader
        // who learns nothing goes looking for the information somewhere else.
        expect(group.healthyMessage.length).toBeGreaterThan(0);
      }
    }
  );
});

describe('no engineering vocabulary reaches a person', () => {
  /**
   * Words that describe how the system is built rather than what the business is doing.
   *
   * The operating-state enums are in here too — `human_attention` is a database value, and the
   * salesperson's word for it is "replied".
   */
  const FORBIDDEN = [
    'bullmq', 'queue', 'worker', 'lease', 'fencing', 'job run', 'jobrun',
    'work order', 'workorder', 'agentaction', 'agent action', 'execution id', 'idempotenc',
    'human_attention', 'ai_managed', 'human_managed', 'waiting_for_prospect',
    'reengagement_eligible', 'ai_reengagement', 'ready_for_outreach', 'replyclass',
    'prisma', 'enum', 'null',
  ];

  it.each(['sdr', 'team_lead', 'floor_manager', 'leadgen_manager', 'director'])(
    'the %s surface uses business language everywhere a person reads',
    async (role) => {
      const surface = await buildRoleSurface(sessionUser(role), emptyConsole, NOW);

      const visible = [
        surface.title,
        surface.focus,
        ...surface.sources,
        ...surface.metrics.flatMap((m) => [m.label, m.hint ?? '']),
        ...surface.groups.flatMap((g) => [g.title, g.description, g.healthyMessage]),
        ...surface.groups.flatMap((g) => g.items.flatMap((i) => [i.primary, i.secondary, i.meta ?? ''])),
      ].join(' \n ').toLowerCase();

      for (const word of FORBIDDEN) {
        expect(visible, `"${word}" reached a user-visible string on the ${role} surface`).not.toContain(word);
      }
    }
  );

  it('keeps the operating-state enum available for tests without rendering it', async () => {
    rows.lead = [
      {
        id: 'lead-1', firstName: 'Dana', lastName: 'Whitfield', company: 'Acme',
        operatingState: 'human_attention',
        operatingStateAt: new Date(NOW.getTime() - 9 * 3_600_000),
        assignedToId: 'sdr-1', assignedTo: { firstName: 'Sam', lastName: 'Reyes' },
        inboundMessages: [{ replyKind: 'pricing' }],
      },
    ];

    const surface = await buildRoleSurface(sessionUser('sdr'), emptyConsole, NOW);
    const needsYou = surface.groups.find((g) => g.key === 'needs_you');

    expect(needsYou?.items[0]?.state).toBe('human_attention');
    expect(needsYou?.items[0]?.secondary).not.toContain('human_attention');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The exception definitions themselves
// ─────────────────────────────────────────────────────────────────────────────

const ownershipRow = (over: Partial<Record<string, unknown>> = {}) => ({
  leadId: 'lead-1',
  name: 'Dana Whitfield',
  company: 'Acme Logistics',
  operatingState: 'human_attention',
  ownerName: 'Sam Reyes',
  ownerId: 'sdr-1',
  stateAt: new Date(NOW.getTime() - 9 * 3_600_000),
  lastHumanActionAt: null,
  replyKindLabel: 'pricing',
  ...over,
}) as never;

describe('what counts as an exception', () => {
  it('a reply older than the SLA with no owner action is late', () => {
    expect(lateHandoffs([ownershipRow()], NOW)).toHaveLength(1);
  });

  it('a reply the owner has already acted on is not late, however long ago it arrived', () => {
    // The clock stops when a person responds. Otherwise a Team Lead's queue would fill with work
    // that has already been done, and they would stop reading it.
    const answered = ownershipRow({ lastHumanActionAt: new Date(NOW.getTime() - 2 * 3_600_000) });
    expect(lateHandoffs([answered], NOW)).toHaveLength(0);
  });

  it('a reply inside the SLA is not an exception yet', () => {
    const fresh = ownershipRow({ stateAt: new Date(NOW.getTime() - 30 * 60_000) });
    expect(lateHandoffs([fresh], NOW)).toHaveLength(0);
  });

  it('a conversation a human owns and has not touched for three days is stalled', () => {
    const stalled = ownershipRow({
      operatingState: 'human_managed',
      lastHumanActionAt: new Date(NOW.getTime() - 96 * 3_600_000),
    });
    expect(stalledConversations([stalled], NOW)).toHaveLength(1);
  });

  it('a conversation being actively worked is not stalled', () => {
    const active = ownershipRow({
      operatingState: 'human_managed',
      lastHumanActionAt: new Date(NOW.getTime() - 3 * 3_600_000),
    });
    expect(stalledConversations([active], NOW)).toHaveLength(0);
  });

  it('re-engagement eligibility nobody has decided on becomes an exception, and reads as a recommendation', () => {
    const eligible = ownershipRow({
      operatingState: 'reengagement_eligible',
      stateAt: new Date(NOW.getTime() - 96 * 3_600_000),
    });
    const [item] = reengagementGaps([eligible], NOW);

    expect(item).toBeDefined();
    // Wording matters here more than anywhere: eligibility is a recommendation, and a surface
    // that phrased it as an instruction would be describing a system that restarts outreach on
    // its own — which is exactly what this one does not do.
    expect(item.secondary).toMatch(/waiting on a person to decide/i);
    expect(item.secondary).not.toMatch(/resum(ed|ing)|restarted|enrolled/i);
  });

  it('an AI-managed prospect is nobody’s exception', () => {
    const healthy = ownershipRow({ operatingState: 'ai_managed' });
    expect(lateHandoffs([healthy], NOW)).toHaveLength(0);
    expect(stalledConversations([healthy], NOW)).toHaveLength(0);
    expect(reengagementGaps([healthy], NOW)).toHaveLength(0);
  });
});
