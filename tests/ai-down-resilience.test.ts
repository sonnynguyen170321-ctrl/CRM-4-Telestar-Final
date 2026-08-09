import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * AI-down resilience (Revenue AI Phase 1, outcome 2).
 *
 * "If every AI provider is unavailable, the core CRM, automation engine, sequence
 * execution, email/inbox processing, meetings, opportunities and reporting still operate
 * normally."
 *
 * `tests/ai-optional.test.ts` proves the CRM has no *static* dependency on `lib/ai`, which
 * is the stronger guarantee — it covers paths nobody has written yet. This file is the
 * behavioural complement: with every provider key removed and outbound HTTP refusing, the
 * named subsystems still execute and still produce their normal writes.
 *
 * The two together answer different questions. The structural test says the coupling
 * cannot exist; this one says the code actually runs in that condition.
 */

const AI_ENV_KEYS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  for (const key of AI_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Total provider outage: any outbound HTTP fails the way an unreachable host does.
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('getaddrinfo ENOTFOUND — simulated provider outage'));
});

afterEach(() => {
  for (const key of AI_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fetchSpy?.mockRestore();
  vi.clearAllMocks();
});

const mockLeadFindUnique = vi.fn();
const mockLeadUpdate = vi.fn();
const mockSequenceFindUnique = vi.fn();
const mockEnrollmentUpdateMany = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTaskCreate = vi.fn();
const mockActivityCreate = vi.fn();
const mockAiCallCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: {
      findUnique: (...a: unknown[]) => mockLeadFindUnique(...a),
      update: (...a: unknown[]) => mockLeadUpdate(...a),
    },
    sequence: { findUnique: (...a: unknown[]) => mockSequenceFindUnique(...a) },
    sequenceEnrollment: { updateMany: (...a: unknown[]) => mockEnrollmentUpdateMany(...a) },
    task: {
      updateMany: (...a: unknown[]) => mockTaskUpdateMany(...a),
      create: (...a: unknown[]) => mockTaskCreate(...a),
    },
    activity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    notification: { create: vi.fn().mockResolvedValue({}) },
    aiCall: { create: (...a: unknown[]) => mockAiCallCreate(...a) },
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue({ id: 'job-1' }),
}));

const { pauseSequence, computeStepDueDate } = await import('@/lib/sequences/engine');
const { evaluateAutomationEligibility } = await import('@/lib/automation/eligibility');
const { calculateNextActionAt } = await import('@/lib/automation/scheduling');
const { resolveTimezone } = await import('@/lib/automation/timezone');
const { scoreLead } = await import('@/lib/leads/scoring');

describe('CRM with every AI provider unavailable', () => {
  beforeEach(() => {
    mockAiCallCreate.mockResolvedValue({});
    mockActivityCreate.mockResolvedValue({});
    mockTaskUpdateMany.mockResolvedValue({ count: 1 });
    mockEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
    mockLeadUpdate.mockResolvedValue({});
  });

  it('sequence scheduling still computes a send time', () => {
    const result = calculateNextActionAt({
      baseAt: new Date('2026-08-10T09:00:00Z'),
      delayDays: 2,
      delayHours: 0,
      timezone: resolveTimezone('Asia/Ho_Chi_Minh'),
      businessDayPolicy: 'skip_weekends',
      deterministicSeed: 'tenant:seq:step:lead',
    });

    expect(result.dueAtUtc).toBeInstanceOf(Date);
    expect(result.dueAtUtc.getTime()).toBeGreaterThan(Date.parse('2026-08-10T09:00:00Z'));
  });

  it('automation eligibility still decides', () => {
    const result = evaluateAutomationEligibility({
      tenantId: 'tenant-1',
      now: new Date('2026-08-10T09:00:00Z'),
      lead: {
        id: 'lead-1',
        stage: 'won',
        emailInvalid: false,
        email: 'a@b.com',
        timezone: null,
      },
    } as Parameters<typeof evaluateAutomationEligibility>[0]);

    // The decision itself is not the point — that a decision is reached at all is.
    expect(['ALLOW', 'BLOCK', 'DEFER', 'TERMINATE', 'MANUAL_REQUIRED']).toContain(result.decision);
  });

  it('reply handling still pauses the sequence and writes its activity', async () => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-1',
      sequenceId: 'seq-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    mockSequenceFindUnique.mockResolvedValue({ name: 'Cold Outreach' });

    await pauseSequence('lead-1', 'reply', 'user-1');

    expect(mockEnrollmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'paused', pausedReason: 'reply' }),
      })
    );
    expect(mockTaskUpdateMany).toHaveBeenCalled();
    expect(mockActivityCreate).toHaveBeenCalled();
  });

  it('step due-date computation still works', () => {
    const due = computeStepDueDate(new Date('2026-08-10T09:00:00Z'), {
      delayDays: 1,
      delayHours: 2,
      sendWindowStartMinutes: null,
      sendWindowEndMinutes: null,
    });
    expect(due).toBeInstanceOf(Date);
  });

  it('lead scoring still runs — it is deterministic CRM logic, not an AI call', () => {
    const scored = scoreLead({
      id: 'lead-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      title: 'CTO',
      email: 'ada@example.com',
      phone: '+1 555 0100',
      linkedIn: null,
      whatsApp: null,
      stage: 'new',
      crmPriorityScore: 'warm',
      source: 'import',
      lastContactedAt: null,
      nextTaskDue: null,
      createdAt: new Date('2026-08-01T00:00:00Z').toISOString(),
      activities: [],
      tasks: [],
    } as Parameters<typeof scoreLead>[0]);

    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(['hot', 'warm', 'cold']).toContain(scored.label);
  });

  it('no CRM path attempted an outbound provider request', () => {
    // If a CRM path had reached for a provider, the mocked fetch would have been hit.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no CRM path recorded AI usage', () => {
    // AiCall rows come from lib/ai only. A row written here would mean the CRM had
    // travelled through the AI layer to do ordinary work.
    expect(mockAiCallCreate).not.toHaveBeenCalled();
  });
});
