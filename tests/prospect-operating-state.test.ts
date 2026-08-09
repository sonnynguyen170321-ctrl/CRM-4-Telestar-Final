import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Prospect operating state and the four ownership transitions (Revenue AI Phase 3).
 *
 * The eight hard rules, plus idempotency keyed on the specific occurrence rather than on
 * (lead, kind) — a prospect legitimately moves AI → human → AI → human, and a coarser key
 * would permanently block the second genuine handoff.
 */

const mockLeadFindUnique = vi.fn();
const mockLeadUpdate = vi.fn();
const mockTransitionFindUnique = vi.fn();
const mockTransitionCreate = vi.fn();
const mockActivityCreate = vi.fn();
const mockTaskCreate = vi.fn();
const mockNotificationCreate = vi.fn();
const mockEnrollmentUpdateMany = vi.fn();
const mockEnrollmentCreate = vi.fn();
const mockOutboundCreate = vi.fn();
const mockEnqueue = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: {
      findUnique: (...a: unknown[]) => mockLeadFindUnique(...a),
      update: (...a: unknown[]) => mockLeadUpdate(...a),
    },
    prospectTransition: {
      findUnique: (...a: unknown[]) => mockTransitionFindUnique(...a),
      create: (...a: unknown[]) => mockTransitionCreate(...a),
    },
    activity: { create: (...a: unknown[]) => mockActivityCreate(...a) },
    task: { create: (...a: unknown[]) => mockTaskCreate(...a) },
    notification: { create: (...a: unknown[]) => mockNotificationCreate(...a) },
    sequenceEnrollment: {
      updateMany: (...a: unknown[]) => mockEnrollmentUpdateMany(...a),
      create: (...a: unknown[]) => mockEnrollmentCreate(...a),
    },
    outboundMessage: { create: (...a: unknown[]) => mockOutboundCreate(...a) },
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a) }));

const {
  handoffProspectToHuman,
  markReengagementEligible,
  handbackProspectToAI,
  startAIReengagement,
  ColdSequenceRestartError,
} = await import('@/lib/prospects/ownership');
const { TransitionNotAllowedError } = await import('@/lib/prospects/transitions');
const { buildTransitionKey } = await import('@/lib/prospects/keys');

const LEAD = {
  id: 'lead-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  company: 'Analytical Engines',
  assignedToId: 'sdr-1',
  operatingState: 'ai_managed' as const,
};

function seedLead(operatingState: string = 'ai_managed') {
  mockLeadFindUnique.mockResolvedValue({ ...LEAD, operatingState });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedLead();
  mockTransitionFindUnique.mockResolvedValue(null);
  mockTransitionCreate.mockResolvedValue({ id: 'transition-1' });
  mockLeadUpdate.mockResolvedValue({});
  mockActivityCreate.mockResolvedValue({});
  mockTaskCreate.mockResolvedValue({});
  mockNotificationCreate.mockResolvedValue({});
});

describe('transition keys identify an occurrence, not a lead and a kind', () => {
  it('two different inbound events on one lead produce different keys', () => {
    const first = buildTransitionKey({ kind: 'handoff', leadId: 'lead-1', eventId: 'msg-1' });
    const second = buildTransitionKey({ kind: 'handoff', leadId: 'lead-1', eventId: 'msg-2' });
    // If these collided, the second genuine reply would be silently swallowed forever.
    expect(first).not.toBe(second);
  });

  it('the same event produces the same key', () => {
    const key = { kind: 'handoff' as const, leadId: 'lead-1', eventId: 'msg-1' };
    expect(buildTransitionKey(key)).toBe(buildTransitionKey(key));
  });

  it('kinds cannot collide with each other', () => {
    expect(buildTransitionKey({ kind: 'handback', leadId: 'l', requestId: 'x' })).not.toBe(
      buildTransitionKey({ kind: 'handoff', leadId: 'l', eventId: 'x' })
    );
  });

  it('refuses a key with a missing component instead of emitting a colliding one', () => {
    expect(() => buildTransitionKey({ kind: 'handoff', leadId: 'lead-1', eventId: '' })).toThrow();
    expect(() => buildTransitionKey({ kind: 'handback', leadId: '', requestId: 'r' })).toThrow();
  });
});

describe('rule 3 — meaningful engagement may hand off automatically', () => {
  it('moves the prospect to human_attention and creates the SDR task and notification', async () => {
    const result = await handoffProspectToHuman({
      leadId: 'lead-1',
      tenantId: 't1',
      eventId: 'msg-1',
      reason: 'replied to your outreach',
    });

    expect(result.applied).toBe(true);
    expect(result.state).toBe('human_attention');
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ operatingState: 'human_attention' }) })
    );
    expect(mockTaskCreate).toHaveBeenCalledOnce();
    expect(mockNotificationCreate).toHaveBeenCalledOnce();
    expect(mockActivityCreate).toHaveBeenCalledOnce();
  });

  it('hands off from any state — a reply is never dropped for an unexpected state', async () => {
    seedLead('unassigned');
    const result = await handoffProspectToHuman({
      leadId: 'lead-1', tenantId: 't1', eventId: 'msg-9', reason: 'replied',
    });
    expect(result.applied).toBe(true);
  });
});

describe('rule 7 + idempotency — a retry produces no duplicates', () => {
  it('a redelivered event creates no second task, notification, activity or ledger row', async () => {
    mockTransitionFindUnique.mockResolvedValue({ id: 'transition-1', toState: 'human_attention' });

    const result = await handoffProspectToHuman({
      leadId: 'lead-1', tenantId: 't1', eventId: 'msg-1', reason: 'replied',
    });

    expect(result.applied).toBe(false);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
    expect(mockActivityCreate).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('a concurrent duplicate loses the unique-constraint race and reports a no-op', async () => {
    mockTransitionCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    mockTransitionFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'transition-1' });

    const result = await handoffProspectToHuman({
      leadId: 'lead-1', tenantId: 't1', eventId: 'msg-1', reason: 'replied',
    });

    // The constraint is the arbiter. The loser must not fail the job.
    expect(result.applied).toBe(false);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it('a genuinely new event later is still allowed', async () => {
    // The AI → human → AI → human case. Keys differ, so nothing blocks the second handoff.
    mockTransitionFindUnique.mockResolvedValue(null);
    const second = await handoffProspectToHuman({
      leadId: 'lead-1', tenantId: 't1', eventId: 'msg-2', reason: 'replied again',
    });
    expect(second.applied).toBe(true);
    expect(mockTaskCreate).toHaveBeenCalledOnce();
  });

  it('handoff idempotency does not depend on Lead.stage', async () => {
    // The reply handler's stage guard is separate, coarser, pre-existing debt. The transition
    // ledger must stand on its own — `stage` is never selected or consulted here.
    const selects = mockLeadFindUnique.mock.calls.map((c) => JSON.stringify(c[0]));
    await handoffProspectToHuman({ leadId: 'lead-1', tenantId: 't1', eventId: 'm', reason: 'r' });
    expect(selects.concat(JSON.stringify(mockLeadFindUnique.mock.calls.at(-1)?.[0])).join()).not.toMatch(/"stage"/);
  });
});

describe('rule 5 — markReengagementEligible is inert', () => {
  it('creates no sequence, enrollment, task, outbound message or queue job', async () => {
    seedLead('waiting_for_prospect');

    const result = await markReengagementEligible({
      leadId: 'lead-1',
      tenantId: 't1',
      episodeId: 'transition-1',
      reason: 'no response for 5 business days',
      actorUserId: 'sdr-1',
    });

    expect(result.applied).toBe(true);
    expect(result.state).toBe('reengagement_eligible');

    // Spying on the writes rather than inspecting the return value: a side effect would not
    // show up in the result, and "eligible" is exactly the word that tempts an implementation
    // into acting.
    expect(mockEnrollmentCreate).not.toHaveBeenCalled();
    expect(mockEnrollmentUpdateMany).not.toHaveBeenCalled();
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockOutboundCreate).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it('still records the state change and explains it on the timeline', async () => {
    seedLead('human_managed');
    await markReengagementEligible({
      leadId: 'lead-1', tenantId: 't1', episodeId: 'ep-1', reason: 'ghosted', actorUserId: 'sdr-1',
    });
    expect(mockActivityCreate).toHaveBeenCalledOnce();
    expect(mockActivityCreate.mock.calls[0][0].data.metadata).toMatchObject({
      recommendationOnly: true,
    });
  });

  it('re-running ghost detection in the same episode is inert', async () => {
    seedLead('reengagement_eligible');
    mockTransitionFindUnique.mockResolvedValue({ id: 't-1', toState: 'reengagement_eligible' });

    const result = await markReengagementEligible({
      leadId: 'lead-1', tenantId: 't1', episodeId: 'ep-1', reason: 'ghosted', actorUserId: 'sdr-1',
    });

    expect(result.applied).toBe(false);
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

describe('rule 4 — nothing leaves human ownership without an explicit SDR handback', () => {
  it('handback records the SDR as the actor, never the system', async () => {
    seedLead('reengagement_eligible');

    const result = await handbackProspectToAI({
      leadId: 'lead-1', tenantId: 't1', requestId: 'req-1', actorUserId: 'sdr-1',
    });

    expect(result.applied).toBe(true);
    expect(result.state).toBe('ai_reengagement');
    expect(mockTransitionCreate.mock.calls[0][0].data.actorUserId).toBe('sdr-1');
  });

  it('handback does not start outreach — that needs an approved plan', async () => {
    seedLead('human_managed');
    await handbackProspectToAI({
      leadId: 'lead-1', tenantId: 't1', requestId: 'req-2', actorUserId: 'sdr-1',
    });
    expect(mockEnrollmentCreate).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('refuses to hand back a prospect that is already AI-owned', async () => {
    seedLead('ai_managed');
    await expect(
      handbackProspectToAI({ leadId: 'lead-1', tenantId: 't1', requestId: 'r', actorUserId: 'sdr-1' })
    ).rejects.toBeInstanceOf(TransitionNotAllowedError);
  });

  it('re-engagement can only start from ai_reengagement, which only handback produces', async () => {
    seedLead('human_managed');
    await expect(
      startAIReengagement({
        leadId: 'lead-1', tenantId: 't1', workOrderId: 'wo-1', actorUserId: 'sdr-1',
        reengagementSequenceId: 'seq-new',
      })
    ).rejects.toBeInstanceOf(TransitionNotAllowedError);
  });
});

describe('rule 8 — re-engagement never restarts the old cold sequence', () => {
  it('refuses when the plan reuses the prior sequence', async () => {
    seedLead('ai_reengagement');
    await expect(
      startAIReengagement({
        leadId: 'lead-1', tenantId: 't1', workOrderId: 'wo-1', actorUserId: 'sdr-1',
        reengagementSequenceId: 'seq-cold',
        priorSequenceId: 'seq-cold',
      })
    ).rejects.toBeInstanceOf(ColdSequenceRestartError);
    expect(mockTransitionCreate).not.toHaveBeenCalled();
  });

  it('accepts a new sequence built for the re-engagement', async () => {
    seedLead('ai_reengagement');
    const result = await startAIReengagement({
      leadId: 'lead-1', tenantId: 't1', workOrderId: 'wo-1', actorUserId: 'sdr-1',
      reengagementSequenceId: 'seq-warm',
      priorSequenceId: 'seq-cold',
    });
    expect(result.applied).toBe(true);
    expect(result.state).toBe('ai_managed');
  });
});
