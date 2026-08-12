import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlaybookRules } from '@/lib/playbooks/policy';

/**
 * Approved learning (Revenue AI Phase 10).
 *
 * The tests here are almost entirely about what must **not** happen. The loop's value depends on
 * one property: an approval moves policy forward by exactly one reviewable step and never further.
 * So the suite pins the four ways that could quietly stop being true —
 *
 * ```text
 * an agent approving its own recommendation
 * an approval editing the version that is running
 * an approval activating anything
 * a proposal whose evidence grows because someone refreshed a page
 * ```
 */

const db = {
  proposal: null as Record<string, unknown> | null,
  reviewer: null as Record<string, unknown> | null,
  baseVersion: null as Record<string, unknown> | null,
  claimCount: 1,
};

const mockVersionCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
  ...data,
  id: 'new-draft-1',
  versionNumber: 2,
  status: 'draft',
}));
const mockVersionUpdateMany = vi.fn(async (_args?: any) => ({ count: 1 }));
const mockPlaybookUpdate = vi.fn(async (_args?: any) => ({}));
const mockProposalUpdateMany = vi.fn(async (_args?: any): Promise<{ count: number }> => ({ count: db.claimCount }));
const mockProposalCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'p-new' }));
const mockProposalUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...(db.proposal ?? {}), ...data }));
const mockEvidenceCreateMany = vi.fn(async (_args?: any) => ({ count: 0 }));
const mockSignalFindMany = vi.fn(async (_args?: any) => [] as unknown[]);
const mockVersionFindFirst = vi.fn(async (_args?: any) => db.baseVersion);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playbookProposal: {
      findUnique: vi.fn(async () => db.proposal),
      findMany: vi.fn(async () => []),
      updateMany: (...a: any[]) => mockProposalUpdateMany(a[0] as any),
      update: (...a: any[]) => mockProposalUpdate(a[0] as any),
      create: (...a: any[]) => mockProposalCreate(a[0] as any),
    },
    playbookProposalEvidence: { createMany: (...a: any[]) => mockEvidenceCreateMany(a[0] as any) },
    outcomeSignal: { findMany: (...a: any[]) => mockSignalFindMany(a[0] as any) },
    campaignPlaybook: {
      findMany: vi.fn(async () => [{ id: 'pb-1', campaignId: 'camp-1' }]),
      findUnique: vi.fn(async () => ({ id: 'pb-1', tenantId: 't1', currentVersionId: 'v-active' })),
      update: (...a: any[]) => mockPlaybookUpdate(a[0] as any),
    },
    campaignPlaybookVersion: {
      findUnique: vi.fn(async () => db.baseVersion),
      findFirst: (...a: any[]) => mockVersionFindFirst(a[0] as any),
      create: (...a: any[]) => mockVersionCreate(a[0] as any),
      updateMany: (...a: any[]) => mockVersionUpdateMany(a[0] as any),
    },
    user: { findFirst: vi.fn(async () => db.reviewer) },
    campaign: { findMany: vi.fn(async () => []) },
  },
}));

const { reviewProposal, ProposalError, buildProposals, canReviewProposals, MIN_SUPPORT } =
  await import('@/lib/learning/proposals');
const { draftRetention, DRAFT_ACCEPTED_THRESHOLD } = await import('@/lib/learning/signals');

const RULES: PlaybookRules = {
  personas: ['VP Operations'],
  valueProposition: 'Cut freight spend without changing carriers.',
  allowedCtas: ['Book 15 minutes'],
  researchDepth: 'light',
  allowedChannels: ['email'],
  ghostThresholdsBusinessDays: {
    positive_reply_waiting: 10,
    proposal_sent: 5,
    meeting_no_show: 2,
    post_demo: 7,
  },
  handoffSlaMinutes: 60,
  sendWindow: null,
  replyHandling: { autoHandleAdministrative: true, oooResumeBufferDays: 1 },
};

const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  tenantId: 't1',
  playbookId: 'pb-1',
  campaignId: 'camp-1',
  basedOnVersionId: 'v-active',
  proposalKey: 'camp-1:reengage-sooner',
  title: 'Follow up sooner',
  observation: 'Re-engagement is working.',
  suggestedChange: 'Offer re-engagement after 6 business days instead of 10.',
  proposedRules: { ghostThresholdsBusinessDays: { ...RULES.ghostThresholdsBusinessDays, positive_reply_waiting: 6 } },
  supportCount: 4,
  status: 'proposed',
  createdVersionId: null,
  reviewedById: null,
  ...over,
});

const activeVersion = {
  id: 'v-active',
  tenantId: 't1',
  playbookId: 'pb-1',
  versionNumber: 1,
  status: 'approved',
  rules: RULES,
  activatedAt: new Date('2026-07-01T00:00:00Z'),
  supersededAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.proposal = proposal();
  db.reviewer = { id: 'fm-1', role: 'floor_manager' };
  db.baseVersion = activeVersion;
  db.claimCount = 1;
  mockProposalUpdateMany.mockImplementation(async () => ({ count: db.claimCount }));
  mockVersionCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data, id: 'new-draft-1', versionNumber: 2, status: 'draft',
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the AI never changes the policy it runs under', () => {
  it('approval creates a NEW draft version and leaves the active one untouched', async () => {
    const result = await reviewProposal({
      tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve',
    });

    // A draft was created…
    expect(mockVersionCreate).toHaveBeenCalledTimes(1);
    expect((mockVersionCreate.mock.calls[0]![0] as any).data).toMatchObject({ status: 'draft', playbookId: 'pb-1' });
    expect(result.createdVersionId).toBe('new-draft-1');

    // …and nothing touched the version that is in force, or the pointer that selects it.
    expect(mockVersionUpdateMany).not.toHaveBeenCalled();
    expect(mockPlaybookUpdate).not.toHaveBeenCalled();
  });

  it('the created draft is a draft — not approved, not activated', async () => {
    await reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve' });

    const created = (mockVersionCreate.mock.calls[0]![0] as any).data as Record<string, unknown>;
    expect(created.status).toBe('draft');
    expect(created.approvedById).toBeUndefined();
    expect(created.approvedAt).toBeUndefined();
    expect(created.activatedAt).toBeUndefined();
  });

  it('says plainly that approval changed nothing that is running', async () => {
    const result = await reviewProposal({
      tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve',
    });
    // The number the confirmation quotes has to be the draft's, or a manager reads "approved" and
    // believes the campaign is already behaving differently.
    expect(result.createdVersionNumber).toBe(2);
    // The proposal is stamped with the decision, the reviewer and the draft it produced.
    expect((mockProposalUpdateMany.mock.calls[0]![0] as any).data).toMatchObject({
      status: 'approved',
      reviewedById: 'fm-1',
      createdVersionId: 'new-draft-1',
    });
  });

  it('merges the proposed change over the base policy and validates the result', async () => {
    await reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve' });

    const rules = ((mockVersionCreate.mock.calls[0]![0] as any).data as { rules: PlaybookRules }).rules;
    expect(rules.ghostThresholdsBusinessDays.positive_reply_waiting).toBe(6);
    // Everything the proposal did not mention survives unchanged.
    expect(rules.valueProposition).toBe(RULES.valueProposition);
    expect(rules.allowedCtas).toEqual(RULES.allowedCtas);
  });

  it('refuses a change that would not produce a valid policy', async () => {
    db.proposal = proposal({ proposedRules: { researchDepth: 'exhaustive' } });

    await expect(
      reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve' })
    ).rejects.toMatchObject({ code: 'invalid_change' });

    expect(mockVersionCreate).not.toHaveBeenCalled();
  });

  it('refuses a proposal that smuggles ICP into the playbook', async () => {
    // ICP belongs to CampaignLeadRequirement. The policy contract is `.strict()`, so this is
    // rejected rather than ignored — two definitions that can disagree is worse than one.
    db.proposal = proposal({ proposedRules: { targetTitles: ['CFO'] } });

    await expect(
      reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve' })
    ).rejects.toMatchObject({ code: 'invalid_change' });
  });
});

describe('a person decides, and it is a person with the authority', () => {
  it('only a Director or Floor Manager may decide', () => {
    expect(canReviewProposals('director')).toBe(true);
    expect(canReviewProposals('floor_manager')).toBe(true);
    expect(canReviewProposals('team_lead')).toBe(false);
    expect(canReviewProposals('sdr')).toBe(false);
    expect(canReviewProposals('leadgen_manager')).toBe(false);
  });

  it('refuses a reviewer whose role may not decide, and creates nothing', async () => {
    db.reviewer = { id: 'sdr-1', role: 'sdr' };

    await expect(
      reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'sdr-1', decision: 'approve' })
    ).rejects.toMatchObject({ code: 'reviewer_not_permitted' });

    expect(mockVersionCreate).not.toHaveBeenCalled();
    expect(mockProposalUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses a reviewer who is not an active user in the tenant — which is every agent', async () => {
    // An agent has no `User` row. That is what makes "no AI process approves its own
    // recommendation" structural rather than a flag someone can forget to check.
    db.reviewer = null;

    await expect(
      reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'agent-runtime', decision: 'approve' })
    ).rejects.toMatchObject({ code: 'reviewer_not_found' });

    expect(mockVersionCreate).not.toHaveBeenCalled();
  });

  it('refuses a proposal from another tenant', async () => {
    await expect(
      reviewProposal({ tenantId: 'other-tenant', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve' })
    ).rejects.toMatchObject({ code: 'wrong_tenant' });
  });

  it('refuses to reopen a decided proposal', async () => {
    db.proposal = proposal({ status: 'rejected', reviewedById: 'fm-1' });

    await expect(
      reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve' })
    ).rejects.toMatchObject({ code: 'already_reviewed' });
  });

  it('two managers deciding at once produce one decision', async () => {
    // The compare-and-set loses, so the second caller is told rather than silently overwriting.
    db.claimCount = 0;

    await expect(
      reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'reject' })
    ).rejects.toMatchObject({ code: 'already_reviewed' });
  });

  it('rejection closes the proposal and creates no version', async () => {
    const result = await reviewProposal({
      tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'reject', note: 'Not for this client.',
    });

    expect(result.createdVersionId).toBeNull();
    expect(mockVersionCreate).not.toHaveBeenCalled();
    expect(mockProposalUpdateMany.mock.calls[0]![0] as any).toMatchObject({
      where: { id: 'p-1', status: 'proposed' },
      data: { status: 'rejected', reviewedById: 'fm-1' },
    });
  });

  it('refuses to apply a change to a campaign that has no approved policy to change', async () => {
    db.proposal = proposal({ basedOnVersionId: null });
    db.baseVersion = null;

    await expect(
      reviewProposal({ tenantId: 't1', proposalId: 'p-1', reviewerId: 'fm-1', decision: 'approve' })
    ).rejects.toMatchObject({ code: 'incomplete_policy' });
  });
});

describe('proposals rest on evidence, and do not nag', () => {
  const signals = (kind: string, count: number, offset = 0) =>
    Array.from({ length: count }, (_, i) => ({ id: `s-${kind}-${i + offset}`, kind, campaignId: 'camp-1' }));

  it('files nothing below the support threshold', async () => {
    mockSignalFindMany.mockResolvedValueOnce(signals('reengagement_reply', MIN_SUPPORT - 1));
    mockVersionFindFirst.mockResolvedValue(activeVersion);

    const result = await buildProposals('t1');
    expect(result.created).toBe(0);
    expect(mockProposalCreate).not.toHaveBeenCalled();
  });

  it('files a proposal once enough outcomes support it, and cites them', async () => {
    mockSignalFindMany.mockResolvedValueOnce(signals('reengagement_reply', 4));
    mockVersionFindFirst.mockResolvedValue(activeVersion);
    // Nothing filed for this pattern yet.
    db.proposal = null;

    const result = await buildProposals('t1');

    expect(result.created).toBe(1);
    const created = (mockProposalCreate.mock.calls[0]![0] as any).data as Record<string, unknown>;
    expect(created.supportCount).toBe(4);
    expect(created.basedOnVersionId).toBe('v-active');
    // The change has to land on a field the policy contract actually has, or nobody can approve it.
    expect((created.proposedRules as { ghostThresholdsBusinessDays: { positive_reply_waiting: number } })
      .ghostThresholdsBusinessDays.positive_reply_waiting).toBeLessThan(10);

    expect(mockEvidenceCreateMany).toHaveBeenCalledTimes(1);
    // `skipDuplicates` is what stops a rebuild inflating the evidence behind an existing proposal.
    expect(mockEvidenceCreateMany.mock.calls[0]![0] as any).toMatchObject({ skipDuplicates: true });
  });

  it('never re-raises a proposal a manager already decided', async () => {
    mockSignalFindMany.mockResolvedValueOnce(signals('reengagement_reply', 6));
    mockVersionFindFirst.mockResolvedValue(activeVersion);
    // The same pattern, already rejected last week.
    db.proposal = proposal({ status: 'rejected' });

    const result = await buildProposals('t1');

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(mockProposalCreate).not.toHaveBeenCalled();
    expect(mockProposalUpdate).not.toHaveBeenCalled();
  });

  it('updates an undecided proposal in place rather than filing a duplicate', async () => {
    mockSignalFindMany.mockResolvedValueOnce(signals('reengagement_reply', 7));
    mockVersionFindFirst.mockResolvedValue(activeVersion);
    db.proposal = proposal({ status: 'proposed' });

    const result = await buildProposals('t1');

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(mockProposalUpdate).toHaveBeenCalledTimes(1);
  });

  it('proposes nothing for a campaign with no playbook to change', async () => {
    mockSignalFindMany.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, i) => ({ id: `s-${i}`, kind: 'reengagement_reply', campaignId: 'camp-without-playbook' }))
    );

    const result = await buildProposals('t1');
    expect(result.created).toBe(0);
  });
});

describe('draft retention is something a manager can recompute', () => {
  it('an unedited draft counts as accepted', () => {
    const draft = 'Happy to walk you through the Rotterdam numbers on Thursday.';
    expect(draftRetention(draft, draft)).toBe(1);
    expect(draftRetention(draft, draft)).toBeGreaterThanOrEqual(DRAFT_ACCEPTED_THRESHOLD);
  });

  it('light editing still counts as accepted', () => {
    const draft = 'Happy to walk you through the Rotterdam numbers on Thursday at ten.';
    const sent = 'Happy to walk you through the Rotterdam numbers on Thursday at eleven!';
    expect(draftRetention(draft, sent)).toBeGreaterThanOrEqual(DRAFT_ACCEPTED_THRESHOLD);
  });

  it('a rewrite does not', () => {
    const draft = 'Happy to walk you through the Rotterdam numbers on Thursday.';
    const sent = 'Thanks for coming back to me — what does your team use today for carrier selection?';
    expect(draftRetention(draft, sent)).toBeLessThan(DRAFT_ACCEPTED_THRESHOLD);
  });

  it('is not fooled by reordering, because reordering is not rewriting', () => {
    const draft = 'Cut freight spend without changing carriers. Book fifteen minutes?';
    const sent = 'Book fifteen minutes? Cut freight spend without changing carriers.';
    expect(draftRetention(draft, sent)).toBeGreaterThanOrEqual(DRAFT_ACCEPTED_THRESHOLD);
  });
});

describe('ProposalError carries a code the API can map to a status', () => {
  it('is an Error with a stable code', () => {
    const err = new ProposalError('nope', 'reviewer_not_permitted');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('reviewer_not_permitted');
  });
});
