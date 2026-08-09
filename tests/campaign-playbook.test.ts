import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parsePlaybookRules,
  ghostThresholdFor,
  InvalidPlaybookRulesError,
  GHOST_SITUATIONS,
  type PlaybookRules,
} from '@/lib/playbooks/policy';

/**
 * Campaign playbooks (Revenue AI Phase 4).
 *
 * A playbook is the stable identity; every rule lives in an immutable version. What the tests
 * below protect is the property that makes attribution possible at all: the policy a campaign
 * ran under at any past instant is still on disk, unedited, inside a window that does not
 * overlap any other.
 */

const mockPlaybookFindUnique = vi.fn();
const mockPlaybookFindMany = vi.fn();
const mockPlaybookUpdate = vi.fn();
const mockVersionFindUnique = vi.fn();
const mockVersionFindFirst = vi.fn();
const mockVersionCreate = vi.fn();
const mockVersionUpdateMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignPlaybook: {
      findUnique: (...a: unknown[]) => mockPlaybookFindUnique(...a),
      findMany: (...a: unknown[]) => mockPlaybookFindMany(...a),
      update: (...a: unknown[]) => mockPlaybookUpdate(...a),
    },
    campaignPlaybookVersion: {
      findUnique: (...a: unknown[]) => mockVersionFindUnique(...a),
      findFirst: (...a: unknown[]) => mockVersionFindFirst(...a),
      create: (...a: unknown[]) => mockVersionCreate(...a),
      updateMany: (...a: unknown[]) => mockVersionUpdateMany(...a),
    },
  },
}));

const {
  createDraftVersion,
  approveVersion,
  updateDraftRules,
  activateVersion,
  versionActiveAt,
  detectActivationDrift,
} = await import('@/lib/playbooks/versions');

const VALID_RULES: PlaybookRules = {
  personas: ['CFO', 'VP Finance'],
  valueProposition: 'Cut month-end close from 10 days to 3.',
  allowedCtas: ['Book 15 minutes'],
  researchDepth: 'standard',
  allowedChannels: ['email', 'linkedin'],
  ghostThresholdsBusinessDays: {
    positive_reply_waiting: 3,
    proposal_sent: 5,
    meeting_no_show: 1,
    post_demo: 7,
  },
  handoffSlaMinutes: 60,
  sendWindow: { startMinutes: 540, endMinutes: 1020, businessDaysOnly: true },
  replyHandling: { autoHandleAdministrative: true, oooResumeBufferDays: 1 },
};

const PLAYBOOK = { id: 'pb-1', tenantId: 't1', currentVersionId: null as string | null };

function version(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v-1',
    tenantId: 't1',
    playbookId: 'pb-1',
    versionNumber: 1,
    status: 'draft',
    rules: VALID_RULES,
    createdById: 'u1',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    approvedById: null,
    approvedAt: null,
    activatedAt: null,
    supersededAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPlaybookFindUnique.mockResolvedValue({ ...PLAYBOOK });
  mockPlaybookUpdate.mockResolvedValue({});
  mockVersionFindFirst.mockResolvedValue(null);
  mockVersionCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    ...version(),
    ...args.data,
  }));
  mockVersionUpdateMany.mockResolvedValue({ count: 1 });
});

describe('policy contract', () => {
  it('accepts a complete policy', () => {
    expect(parsePlaybookRules(VALID_RULES)).toEqual(VALID_RULES);
  });

  it('rejects an unknown key rather than storing it', () => {
    // A stray key is a typo or a field someone expected to be honoured. Storing it silently
    // produces a playbook that reads as if it says something it does not.
    expect(() => parsePlaybookRules({ ...VALID_RULES, icp: 'CFOs at logistics firms' })).toThrow(
      InvalidPlaybookRulesError
    );
  });

  it('has no ICP field — that authority belongs to CampaignLeadRequirement', () => {
    // Two ICP definitions that can disagree is worse than one. The schema refuses to hold a
    // second copy, which is stronger than a convention that it should not.
    for (const key of ['icp', 'targetTitles', 'targetIndustries', 'companySizeMin']) {
      expect(() => parsePlaybookRules({ ...VALID_RULES, [key]: 'x' })).toThrow();
    }
  });

  it('requires a threshold for every ghost situation, and they differ', () => {
    for (const situation of GHOST_SITUATIONS) {
      expect(ghostThresholdFor(VALID_RULES, situation)).toBeGreaterThan(0);
    }
    // A single number would be wrong for at least three of the four.
    expect(ghostThresholdFor(VALID_RULES, 'meeting_no_show')).not.toBe(
      ghostThresholdFor(VALID_RULES, 'post_demo')
    );

    const missing = { ...VALID_RULES.ghostThresholdsBusinessDays } as Record<string, number>;
    delete missing.post_demo;
    expect(() =>
      parsePlaybookRules({ ...VALID_RULES, ghostThresholdsBusinessDays: missing })
    ).toThrow(InvalidPlaybookRulesError);
  });

  it('rejects an inverted send window', () => {
    expect(() =>
      parsePlaybookRules({
        ...VALID_RULES,
        sendWindow: { startMinutes: 1020, endMinutes: 540, businessDaysOnly: true },
      })
    ).toThrow(InvalidPlaybookRulesError);
  });

  it('bounds the handoff SLA and requires at least one channel', () => {
    expect(() => parsePlaybookRules({ ...VALID_RULES, handoffSlaMinutes: 0 })).toThrow();
    expect(() => parsePlaybookRules({ ...VALID_RULES, allowedChannels: [] })).toThrow();
  });
});

describe('version numbers are monotonic per playbook', () => {
  it('starts at 1', async () => {
    mockVersionFindFirst.mockResolvedValue(null);
    await createDraftVersion({ playbookId: 'pb-1', tenantId: 't1', createdById: 'u1', rules: VALID_RULES });
    expect(mockVersionCreate.mock.calls[0][0].data.versionNumber).toBe(1);
  });

  it('increments from the highest existing', async () => {
    mockVersionFindFirst.mockResolvedValue({ versionNumber: 7 });
    await createDraftVersion({ playbookId: 'pb-1', tenantId: 't1', createdById: 'u1', rules: VALID_RULES });
    expect(mockVersionCreate.mock.calls[0][0].data.versionNumber).toBe(8);
  });

  it('a new draft always starts as draft with no activation', async () => {
    const draft = await createDraftVersion({
      playbookId: 'pb-1', tenantId: 't1', createdById: 'u1', rules: VALID_RULES,
    });
    expect(draft.status).toBe('draft');
    expect(mockVersionCreate.mock.calls[0][0].data.activatedAt).toBeUndefined();
  });
});

describe('an approved version is immutable', () => {
  it('refuses an edit and says to create a new draft', async () => {
    mockVersionFindUnique.mockResolvedValue(version({ status: 'approved', approvedById: 'u2' }));

    await expect(updateDraftRules('v-1', 't1', VALID_RULES)).rejects.toMatchObject({
      name: 'PlaybookVersionError',
      code: 'immutable',
    });
    expect(mockVersionUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses an edit to a superseded version', async () => {
    mockVersionFindUnique.mockResolvedValue(version({ status: 'superseded' }));
    await expect(updateDraftRules('v-1', 't1', VALID_RULES)).rejects.toMatchObject({ code: 'immutable' });
  });

  it('loses the edit if the version is approved between read and write', async () => {
    mockVersionFindUnique.mockResolvedValue(version({ status: 'draft' }));
    mockVersionUpdateMany.mockResolvedValue({ count: 0 });
    await expect(updateDraftRules('v-1', 't1', VALID_RULES)).rejects.toMatchObject({ code: 'immutable' });
  });

  it('allows editing a draft', async () => {
    mockVersionFindUnique.mockResolvedValue(version({ status: 'draft' }));
    await updateDraftRules('v-1', 't1', VALID_RULES);
    expect(mockVersionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'draft' }) })
    );
  });
});

describe('only an approved version may be activated', () => {
  it('refuses a draft', async () => {
    mockVersionFindUnique.mockResolvedValue(version({ status: 'draft' }));
    await expect(activateVersion('v-1', 't1')).rejects.toMatchObject({ code: 'not_approved' });
    expect(mockPlaybookUpdate).not.toHaveBeenCalled();
  });

  it('refuses to reactivate a superseded version', async () => {
    // Policy is reused by creating a new version from it, never by resurrecting the old row —
    // reactivation would tear a hole in the activation timeline.
    mockVersionFindUnique.mockResolvedValue(
      version({ status: 'superseded', activatedAt: new Date(), supersededAt: new Date() })
    );
    await expect(activateVersion('v-1', 't1')).rejects.toMatchObject({ code: 'superseded' });
  });

  it('every activated version carries approvedBy and approvedAt', async () => {
    const approved = version({ status: 'approved', approvedById: 'u2', approvedAt: new Date() });
    mockVersionFindUnique.mockResolvedValue(approved);

    const result = await activateVersion('v-1', 't1');

    expect(result.version.approvedById).toBeTruthy();
    expect(result.version.approvedAt).toBeTruthy();
  });
});

describe('activation supersedes at the same boundary instant', () => {
  it('closes the outgoing window exactly where the incoming one opens', async () => {
    const boundary = new Date('2026-08-10T12:00:00Z');
    mockVersionFindUnique.mockResolvedValue(
      version({ id: 'v-2', versionNumber: 2, status: 'approved', approvedById: 'u2', approvedAt: new Date() })
    );
    mockVersionFindFirst.mockResolvedValue({ id: 'v-1' });

    const result = await activateVersion('v-2', 't1', boundary);

    expect(result.supersededVersionId).toBe('v-1');
    // Same timestamp on both sides: half-open windows must tile with no gap and no overlap,
    // or an event in between belongs to two versions or to none.
    expect(mockVersionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'v-1' }),
        data: { status: 'superseded', supersededAt: boundary },
      })
    );
    expect(mockVersionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'v-2' }),
        data: { activatedAt: boundary },
      })
    );
  });

  it('points the playbook at the new version', async () => {
    mockVersionFindUnique.mockResolvedValue(
      version({ status: 'approved', approvedById: 'u2', approvedAt: new Date() })
    );
    await activateVersion('v-1', 't1');
    expect(mockPlaybookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentVersionId: 'v-1' } })
    );
  });

  it('repeating the same activation is idempotent', async () => {
    const activeAt = new Date('2026-08-10T12:00:00Z');
    mockVersionFindUnique.mockResolvedValue(
      version({ status: 'approved', approvedById: 'u2', approvedAt: new Date(), activatedAt: activeAt })
    );
    mockPlaybookFindUnique.mockResolvedValue({ ...PLAYBOOK, currentVersionId: 'v-1' });

    const result = await activateVersion('v-1', 't1');

    expect(result.changed).toBe(false);
    expect(result.boundaryAt).toBe(activeAt);
    expect(mockVersionUpdateMany).not.toHaveBeenCalled();
    expect(mockPlaybookUpdate).not.toHaveBeenCalled();
  });

  it('a repeat repairs a pointer left behind by an interrupted activation', async () => {
    // The detectable intermediate state the non-transactional swap trades for: the version is
    // active but the playbook still points elsewhere. Re-running activation fixes it.
    const activeAt = new Date('2026-08-10T12:00:00Z');
    mockVersionFindUnique.mockResolvedValue(
      version({ status: 'approved', approvedById: 'u2', approvedAt: new Date(), activatedAt: activeAt })
    );
    mockPlaybookFindUnique.mockResolvedValue({ ...PLAYBOOK, currentVersionId: 'v-old' });

    const result = await activateVersion('v-1', 't1');

    expect(result.changed).toBe(false);
    expect(mockPlaybookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentVersionId: 'v-1' } })
    );
  });
});

describe('attribution by activation window', () => {
  it('asks for the version whose half-open window contains the instant', async () => {
    const at = new Date('2026-08-10T12:00:00Z');
    mockVersionFindFirst.mockResolvedValue(version({ id: 'v-2' }));

    await versionActiveAt('pb-1', 't1', at);

    const where = mockVersionFindFirst.mock.calls[0][0].where;
    expect(where.activatedAt).toEqual({ lte: at });
    // supersededAt is exclusive: a version superseded exactly at T does not own T.
    expect(where.OR).toEqual([{ supersededAt: null }, { supersededAt: { gt: at } }]);
    expect(where.tenantId).toBe('t1');
  });

  it('a historical version stays readable after supersession', async () => {
    mockVersionFindFirst.mockResolvedValue(
      version({
        id: 'v-1',
        status: 'superseded',
        activatedAt: new Date('2026-07-01T00:00:00Z'),
        supersededAt: new Date('2026-08-01T00:00:00Z'),
      })
    );

    const found = await versionActiveAt('pb-1', 't1', new Date('2026-07-15T00:00:00Z'));

    expect(found?.id).toBe('v-1');
    expect(found?.rules).toEqual(VALID_RULES);
  });
});

describe('tenant isolation holds at the domain boundary', () => {
  it('refuses a version from another tenant', async () => {
    mockVersionFindUnique.mockResolvedValue(version({ tenantId: 'other-tenant' }));
    await expect(activateVersion('v-1', 't1')).rejects.toMatchObject({ code: 'wrong_tenant' });
    await expect(updateDraftRules('v-1', 't1', VALID_RULES)).rejects.toMatchObject({ code: 'wrong_tenant' });
  });

  it('refuses a playbook from another tenant', async () => {
    mockPlaybookFindUnique.mockResolvedValue({ ...PLAYBOOK, tenantId: 'other-tenant' });
    await expect(
      createDraftVersion({ playbookId: 'pb-1', tenantId: 't1', createdById: 'u1', rules: VALID_RULES })
    ).rejects.toMatchObject({ code: 'wrong_tenant' });
    expect(mockVersionCreate).not.toHaveBeenCalled();
  });

  it('drift detection is scoped to one tenant', async () => {
    mockPlaybookFindMany.mockResolvedValue([]);
    await detectActivationDrift('t1');
    expect(mockPlaybookFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' } })
    );
  });
});

describe('a playbook operation never executes outreach', () => {
  it('the module touches no sequence, enrollment, task, outbound or queue', async () => {
    // Rule 11: creating or changing a threshold must never enrol, resume or send anything. The
    // Prisma mock exposes only playbook models, so any such call would throw rather than pass
    // silently — and approving plus activating a version exercises the whole write path.
    mockVersionFindUnique.mockResolvedValue(version({ status: 'draft' }));
    await approveVersion('v-1', 't1', 'u2');

    mockVersionFindUnique.mockResolvedValue(
      version({ status: 'approved', approvedById: 'u2', approvedAt: new Date() })
    );
    await expect(activateVersion('v-1', 't1')).resolves.toBeTruthy();
  });

  it('declares a send window but applies nothing itself', async () => {
    // The value reaches a prospect only through approved sequence configuration,
    // assertSendWindowPermission, SequenceStep and the automation scheduler.
    const source = await import('@/lib/playbooks/versions');
    const policy = await import('@/lib/playbooks/policy');
    for (const mod of [source, policy]) {
      expect(Object.keys(mod).join(',')).not.toMatch(/schedule|enroll|send|calculateNextActionAt/i);
    }
  });
});
