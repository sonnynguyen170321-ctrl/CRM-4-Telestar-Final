import { prisma } from '@/lib/prisma';
import type { PlaybookProposal, Prisma } from '@prisma/client';
import { parsePlaybookRules, type PlaybookRules } from '@/lib/playbooks/policy';
import { createDraftVersion, versionActiveAt } from '@/lib/playbooks/versions';

/**
 * Approved learning (Revenue AI Phase 10).
 *
 * ```text
 * an outcome that happened  →  the signals recording it  →  an observation
 *   →  a proposed policy change  →  a manager reads the evidence  →  a NEW playbook version
 * ```
 *
 * ## The invariant this file exists to hold
 *
 * **The AI never modifies the policy it runs under.** Not "should not" — cannot: there is no code
 * path in this module that writes `CampaignPlaybookVersion.rules` on an existing row, that sets
 * `status: 'approved'` on a version, or that touches `CampaignPlaybook.currentVersionId`.
 * Approving a proposal calls `createDraftVersion`, which produces a *draft*. That draft then needs
 * the same human approval and the same human activation every other version has ever needed.
 *
 * So an approved proposal moves policy exactly one step: from "nobody has written this down" to
 * "there is a draft someone can consider". The active version is untouched and stays untouched.
 *
 * ## And the reviewer is a person
 *
 * `reviewProposal` resolves the reviewer as a `User` row and checks their CRM role. An agent has
 * no user row and no role, so "AI approves its own recommendation" is not a case that needs
 * blocking with a flag — it has nothing to present at the door.
 */

export class ProposalError extends Error {
  constructor(message: string, readonly code: ProposalErrorCode) {
    super(message);
    this.name = 'ProposalError';
  }
}

export type ProposalErrorCode =
  | 'not_found'
  | 'wrong_tenant'
  | 'already_reviewed'
  | 'reviewer_not_found'
  | 'reviewer_not_permitted'
  | 'incomplete_policy'
  | 'invalid_change';

/**
 * Who may decide.
 *
 * Playbook policy is campaign-level, so this is the same authority that already owns campaigns —
 * Director and Floor Manager. A Team Lead coaches the people running a campaign; they do not set
 * what the campaign is authorised to say.
 */
export const PROPOSAL_REVIEWER_ROLES = ['director', 'floor_manager'] as const;

export function canReviewProposals(role: string): boolean {
  return (PROPOSAL_REVIEWER_ROLES as readonly string[]).includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// Building proposals
// ─────────────────────────────────────────────────────────────────────────────

/** Below this much evidence a pattern is an anecdote, and proposing a policy change on it is noise. */
export const MIN_SUPPORT = 3;

interface CampaignEvidence {
  campaignId: string;
  playbookId: string;
  positiveReplies: string[];
  reengagementReplies: string[];
  objections: string[];
  meetings: string[];
  rejections: string[];
  draftsEdited: string[];
  draftsAccepted: string[];
}

interface PatternResult {
  proposalKey: string;
  title: string;
  observation: string;
  suggestedChange: string;
  /** The partial policy override an approval would apply. */
  proposedRules: Partial<PlaybookRules>;
  signalIds: string[];
}

/**
 * The patterns the system is allowed to propose from.
 *
 * Deliberately a short, fixed, deterministic list rather than a model writing free-form policy.
 * Two reasons. A manager approving a change needs to be able to check the arithmetic, and every
 * proposal has to land on a field the playbook contract actually has — a beautifully argued
 * suggestion that maps to no policy value is something nobody can approve.
 */
function detectPatterns(evidence: CampaignEvidence, rules: PlaybookRules | null): PatternResult[] {
  const found: PatternResult[] = [];
  const key = (name: string) => `${evidence.campaignId}:${name}`;

  // 1. Re-engagement is working, and we are waiting too long before doing it.
  if (evidence.reengagementReplies.length >= MIN_SUPPORT && rules) {
    const current = rules.ghostThresholdsBusinessDays.positive_reply_waiting;
    const proposed = Math.max(2, Math.round(current * 0.6));
    if (proposed < current) {
      found.push({
        proposalKey: key('reengage-sooner'),
        title: 'Follow up sooner after a prospect goes quiet',
        observation: `${evidence.reengagementReplies.length} prospects replied to a re-engagement follow-up. Follow-ups on this campaign are working, and the campaign currently waits ${current} business days before offering one.`,
        suggestedChange: `Offer re-engagement after ${proposed} business days instead of ${current}, for prospects who went quiet after showing interest.`,
        proposedRules: {
          ghostThresholdsBusinessDays: { ...rules.ghostThresholdsBusinessDays, positive_reply_waiting: proposed },
        },
        signalIds: evidence.reengagementReplies,
      });
    }
  }

  // 2. Objections dominate the conversations we do win — the opening is not pre-empting them.
  const engaged = evidence.positiveReplies.length + evidence.reengagementReplies.length;
  if (evidence.objections.length >= MIN_SUPPORT && engaged > 0 && evidence.objections.length / engaged >= 0.4) {
    found.push({
      proposalKey: key('objection-heavy'),
      title: 'Address the recurring objection in the first message',
      observation: `${evidence.objections.length} of ${engaged} engaged prospects opened with an objection rather than interest. The objection is being handled after it is raised rather than before.`,
      suggestedChange:
        'Update the personalization guidance so the opening message acknowledges the objection this audience raises most, instead of leaving it to the reply.',
      proposedRules: {
        personalizationPolicy: [
          rules?.personalizationPolicy?.trim(),
          'Acknowledge the most common objection for this audience in the opening message, in one sentence, before proposing a next step.',
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 4000),
      },
      signalIds: evidence.objections,
    });
  }

  // 3. Rejections outweigh engagement — we are contacting the wrong people, or saying the wrong
  //    thing to the right ones. Research depth is the policy lever for both.
  if (
    evidence.rejections.length >= MIN_SUPPORT &&
    evidence.rejections.length > engaged * 2 &&
    rules &&
    rules.researchDepth !== 'deep'
  ) {
    const next: PlaybookRules['researchDepth'] =
      rules.researchDepth === 'none' ? 'light' : rules.researchDepth === 'light' ? 'standard' : 'deep';
    found.push({
      proposalKey: key('research-depth'),
      title: 'Research prospects more thoroughly before contacting them',
      observation: `${evidence.rejections.length} rejections against ${engaged} engaged prospects. Outreach is reaching people who do not recognise the reason they were contacted.`,
      suggestedChange: `Raise research depth from ${rules.researchDepth} to ${next} so every message is grounded in something specific to the account.`,
      proposedRules: { researchDepth: next },
      signalIds: evidence.rejections,
    });
  }

  // 4. Reps are rewriting the drafts. The draft guidance, not the rep, is the problem.
  if (
    evidence.draftsEdited.length >= MIN_SUPPORT &&
    evidence.draftsEdited.length > evidence.draftsAccepted.length
  ) {
    found.push({
      proposalKey: key('drafts-rewritten'),
      title: 'Reps are rewriting suggested replies',
      observation: `${evidence.draftsEdited.length} suggested replies were substantially rewritten before sending, against ${evidence.draftsAccepted.length} sent as written. The guidance behind the drafts does not match how this campaign actually talks.`,
      suggestedChange:
        'Revise the value proposition and the approved calls to action to match the language reps are rewriting them into.',
      proposedRules: {},
      signalIds: evidence.draftsEdited,
    });
  }

  return found;
}

export interface BuildProposalsResult {
  created: number;
  updated: number;
  proposals: PlaybookProposal[];
}

/**
 * Look at the evidence and file proposals.
 *
 * Idempotent by `proposalKey`: a second run over the same evidence updates the existing row's
 * support and wording rather than filing a duplicate. A proposal a manager has already decided is
 * never reopened — re-proposing something that was rejected last week is how an approval process
 * turns into a nag.
 */
export async function buildProposals(tenantId: string, now: Date = new Date()): Promise<BuildProposalsResult> {
  const since = new Date(now.getTime() - 60 * 86_400_000);

  const signals = await prisma.outcomeSignal.findMany({
    where: { tenantId, occurredAt: { gte: since }, campaignId: { not: null } },
    select: { id: true, kind: true, campaignId: true },
    take: 10_000,
  });

  const playbooks = await prisma.campaignPlaybook.findMany({
    where: { tenantId },
    select: { id: true, campaignId: true },
  });
  const playbookByCampaign = new Map(playbooks.map((p) => [p.campaignId, p.id]));

  const byCampaign = new Map<string, CampaignEvidence>();
  for (const signal of signals) {
    const campaignId = signal.campaignId!;
    const playbookId = playbookByCampaign.get(campaignId);
    // No playbook means no policy to change. The evidence is still on file for reporting.
    if (!playbookId) continue;

    const entry =
      byCampaign.get(campaignId) ??
      {
        campaignId,
        playbookId,
        positiveReplies: [], reengagementReplies: [], objections: [],
        meetings: [], rejections: [], draftsEdited: [], draftsAccepted: [],
      };
    switch (signal.kind) {
      case 'positive_reply': entry.positiveReplies.push(signal.id); break;
      case 'reengagement_reply': entry.reengagementReplies.push(signal.id); break;
      case 'objection_raised': entry.objections.push(signal.id); break;
      case 'meeting_booked': entry.meetings.push(signal.id); break;
      case 'lead_rejected': entry.rejections.push(signal.id); break;
      case 'draft_edited': entry.draftsEdited.push(signal.id); break;
      case 'draft_accepted': entry.draftsAccepted.push(signal.id); break;
      default: break;
    }
    byCampaign.set(campaignId, entry);
  }

  const result: BuildProposalsResult = { created: 0, updated: 0, proposals: [] };

  for (const evidence of byCampaign.values()) {
    const active = await versionActiveAt(evidence.playbookId, tenantId, now);
    const rules = active ? safeRules(active.rules) : null;

    for (const pattern of detectPatterns(evidence, rules)) {
      const existing = await prisma.playbookProposal.findUnique({
        where: { tenantId_proposalKey: { tenantId, proposalKey: pattern.proposalKey } },
        select: { id: true, status: true },
      });

      // A decided proposal stays decided. Re-filing it would let the system out-wait a manager.
      if (existing && existing.status !== 'proposed') continue;

      const data = {
        title: pattern.title,
        observation: pattern.observation,
        suggestedChange: pattern.suggestedChange,
        proposedRules: pattern.proposedRules as unknown as Prisma.InputJsonValue,
        supportCount: pattern.signalIds.length,
        basedOnVersionId: active?.id ?? null,
      };

      const proposal = existing
        ? await prisma.playbookProposal.update({ where: { id: existing.id }, data })
        : await prisma.playbookProposal.create({
            data: {
              ...data,
              tenantId,
              playbookId: evidence.playbookId,
              campaignId: evidence.campaignId,
              proposalKey: pattern.proposalKey,
            },
          });

      // Evidence links are additive and unique per (proposal, signal) — a rebuild adds newly
      // observed signals without duplicating the ones already cited.
      await prisma.playbookProposalEvidence.createMany({
        data: pattern.signalIds.map((signalId) => ({ proposalId: proposal.id, signalId })),
        skipDuplicates: true,
      });

      if (existing) result.updated += 1;
      else result.created += 1;
      result.proposals.push(proposal);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reviewing proposals
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewInput {
  tenantId: string;
  proposalId: string;
  reviewerId: string;
  decision: 'approve' | 'reject';
  note?: string | null;
}

export interface ReviewResult {
  proposal: PlaybookProposal;
  /** The **draft** an approval produced. Never approved and never activated by this call. */
  createdVersionId: string | null;
  createdVersionNumber: number | null;
}

export async function reviewProposal(input: ReviewInput): Promise<ReviewResult> {
  const proposal = await prisma.playbookProposal.findUnique({ where: { id: input.proposalId } });
  if (!proposal) throw new ProposalError('Proposal not found', 'not_found');
  if (proposal.tenantId !== input.tenantId) throw new ProposalError('Proposal belongs to another tenant', 'wrong_tenant');
  if (proposal.status !== 'proposed') throw new ProposalError(`Proposal is already ${proposal.status}`, 'already_reviewed');

  // The reviewer is resolved from the database, not taken on the caller's word. An agent has no
  // row here, which is what makes "no AI process approves its own recommendation" structural.
  const reviewer = await prisma.user.findFirst({
    where: { id: input.reviewerId, tenantId: input.tenantId, isActive: true },
    select: { id: true, role: true },
  });
  if (!reviewer) throw new ProposalError('Reviewer is not an active user in this tenant', 'reviewer_not_found');
  if (!canReviewProposals(reviewer.role)) {
    throw new ProposalError(`Role ${reviewer.role} may not decide playbook proposals`, 'reviewer_not_permitted');
  }

  if (input.decision === 'reject') {
    const rejected = await claim(proposal.id, {
      status: 'rejected',
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
      decisionNote: input.note ?? null,
    });
    return { proposal: rejected, createdVersionId: null, createdVersionNumber: null };
  }

  // ─── approve: build a NEW draft, change nothing that already exists ───
  const base = proposal.basedOnVersionId
    ? await prisma.campaignPlaybookVersion.findUnique({ where: { id: proposal.basedOnVersionId } })
    : null;

  if (!base) {
    // Without a base policy there is nothing to merge into a valid version. The proposal is still
    // worth recording as approved-in-principle, but it produces no draft and says so.
    throw new ProposalError(
      'This campaign has no approved playbook version to base a change on. Create and approve a first version before applying proposals.',
      'incomplete_policy'
    );
  }

  const merged = { ...(base.rules as object), ...((proposal.proposedRules ?? {}) as object) };
  let validated: PlaybookRules;
  try {
    // The same door every other policy comes through. A proposal that cannot produce a valid
    // policy is refused here rather than stored as a version nobody can parse.
    validated = parsePlaybookRules(merged);
  } catch (err) {
    throw new ProposalError(
      `The proposed change does not produce a valid policy: ${(err as Error).message}`,
      'invalid_change'
    );
  }

  // Claim the decision *before* building anything.
  //
  // Everything above this line is a read or a pure validation, so losing the race here costs
  // nothing. Creating the draft first was the bug: two managers approving at once both passed the
  // `status === 'proposed'` read above, both created a version, and only then did one lose the
  // compare-and-set — leaving the loser's draft behind, numbered off a decision the database says
  // never happened and attributed to a reviewer who was told they were too late.
  const approved = await claim(proposal.id, {
    status: 'approved',
    reviewedById: reviewer.id,
    reviewedAt: new Date(),
    decisionNote: input.note ?? null,
  });

  const draft = await createDraftVersion({
    playbookId: proposal.playbookId,
    tenantId: input.tenantId,
    createdById: reviewer.id,
    rules: validated,
    // The link lives on the version, under a unique key, so a second draft for this proposal is
    // refused by the database rather than by the order these statements happen to run in.
    fromProposalId: proposal.id,
  });

  return { proposal: approved, createdVersionId: draft.id, createdVersionNumber: draft.versionNumber };
}

export interface CompleteApprovedInput {
  tenantId: string;
  proposalId: string;
}

/**
 * Finish an approval whose draft never got created.
 *
 * The residual failure mode this closes: `createDraftVersion` throws *after* the claim wins, so the
 * proposal reads `approved` with no draft — and `reviewProposal` will not re-enter, because the
 * status is no longer `proposed`. That guard is correct and stays; this is a different operation.
 * It **finishes** a decision rather than retaking one: no claim, no reviewer change, no status
 * change. A proposal nobody approved is refused.
 *
 * Safe to call repeatedly. The existing draft is found by the same unique key that would refuse a
 * duplicate, so two concurrent repairs converge on one version instead of racing to create two.
 */
export async function completeApprovedProposal(input: CompleteApprovedInput): Promise<ReviewResult> {
  const proposal = await prisma.playbookProposal.findUnique({ where: { id: input.proposalId } });
  if (!proposal) throw new ProposalError('Proposal not found', 'not_found');
  if (proposal.tenantId !== input.tenantId) {
    throw new ProposalError('Proposal belongs to another tenant', 'wrong_tenant');
  }
  if (proposal.status !== 'approved') {
    throw new ProposalError(
      `Only an approved proposal can be completed; this one is ${proposal.status}`,
      'already_reviewed'
    );
  }
  // An approved proposal with no reviewer is a defect, not a case to paper over: the draft has to
  // be attributed to the person who decided, and there is nobody else to attribute it to.
  if (!proposal.reviewedById) {
    throw new ProposalError(
      'This proposal is approved but records no reviewer, so its draft cannot be attributed',
      'reviewer_not_found'
    );
  }

  const existing = await prisma.campaignPlaybookVersion.findFirst({
    where: { fromProposalId: proposal.id, tenantId: input.tenantId },
    select: { id: true, versionNumber: true },
  });
  if (existing) {
    return {
      proposal,
      createdVersionId: existing.id,
      createdVersionNumber: existing.versionNumber,
    };
  }

  const base = proposal.basedOnVersionId
    ? await prisma.campaignPlaybookVersion.findUnique({ where: { id: proposal.basedOnVersionId } })
    : null;
  if (!base) {
    throw new ProposalError(
      'This campaign has no approved playbook version to base a change on. Create and approve a first version before applying proposals.',
      'incomplete_policy'
    );
  }

  const merged = { ...(base.rules as object), ...((proposal.proposedRules ?? {}) as object) };
  let validated: PlaybookRules;
  try {
    validated = parsePlaybookRules(merged);
  } catch (err) {
    throw new ProposalError(
      `The proposed change does not produce a valid policy: ${(err as Error).message}`,
      'invalid_change'
    );
  }

  const draft = await createDraftVersion({
    playbookId: proposal.playbookId,
    tenantId: input.tenantId,
    // The person who decided still owns the draft. This repair introduces no new author.
    createdById: proposal.reviewedById,
    rules: validated,
    fromProposalId: proposal.id,
  });

  return { proposal, createdVersionId: draft.id, createdVersionNumber: draft.versionNumber };
}

/**
 * Compare-and-set on `status`, so two managers clicking at once produce one decision.
 *
 * The loser is told the proposal was already reviewed rather than silently overwriting the first
 * decision. Callers must claim *before* creating anything a lost race would strand: this is the
 * only point at which a decision becomes this caller's to act on.
 */
async function claim(
  id: string,
  // `unchecked` rather than the relation form: the caller sets `createdVersionId` directly, and a
  // relation `connect` is not expressible in an `updateMany` payload.
  data: Prisma.PlaybookProposalUncheckedUpdateManyInput
): Promise<PlaybookProposal> {
  const claimed = await prisma.playbookProposal.updateMany({ where: { id, status: 'proposed' }, data });
  if (claimed.count !== 1) {
    throw new ProposalError('Proposal was decided by someone else first', 'already_reviewed');
  }
  const updated = await prisma.playbookProposal.findUnique({ where: { id } });
  if (!updated) throw new ProposalError('Proposal not found', 'not_found');
  return updated;
}

export interface ProposalView {
  id: string;
  campaignId: string;
  campaignName: string | null;
  title: string;
  observation: string;
  suggestedChange: string;
  status: string;
  supportCount: number;
  /** What approving does, stated before it is done. */
  ifApproved: string;
  ifRejected: string;
  basedOnVersionNumber: number | null;
  createdVersionNumber: number | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  evidence: Array<{ kind: string; detail: string | null; occurredAt: Date; leadId: string | null }>;
  createdAt: Date;
}

/** Proposals for a manager surface, with the evidence they rest on. */
export async function listProposals(tenantId: string, limit = 20): Promise<ProposalView[]> {
  const proposals = await prisma.playbookProposal.findMany({
    where: { tenantId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      basedOnVersion: { select: { versionNumber: true } },
      createdVersion: { select: { versionNumber: true } },
      evidence: {
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { signal: { select: { kind: true, detail: true, occurredAt: true, leadId: true } } },
      },
    },
  });

  const campaignIds = [...new Set(proposals.map((p) => p.campaignId))];
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } })
    : [];
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));

  const reviewerIds = [...new Set(proposals.map((p) => p.reviewedById).filter((id): id is string => Boolean(id)))];
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const reviewerName = new Map(reviewers.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));

  return proposals.map((p) => ({
    id: p.id,
    campaignId: p.campaignId,
    campaignName: campaignName.get(p.campaignId) ?? null,
    title: p.title,
    observation: p.observation,
    suggestedChange: p.suggestedChange,
    status: p.status,
    supportCount: p.supportCount,
    ifApproved:
      'A new draft playbook version is created with this change. Nothing sends differently until someone approves and activates that draft.',
    ifRejected: 'The proposal is closed and will not be raised again. The evidence stays on file.',
    basedOnVersionNumber: p.basedOnVersion?.versionNumber ?? null,
    createdVersionNumber: p.createdVersion?.versionNumber ?? null,
    reviewedByName: p.reviewedById ? reviewerName.get(p.reviewedById) ?? null : null,
    reviewedAt: p.reviewedAt,
    evidence: p.evidence.map((e) => ({
      kind: e.signal.kind,
      detail: e.signal.detail,
      occurredAt: e.signal.occurredAt,
      leadId: e.signal.leadId,
    })),
    createdAt: p.createdAt,
  }));
}

/** Read stored rules without letting a malformed row take a whole surface down. */
function safeRules(stored: unknown): PlaybookRules | null {
  try {
    return parsePlaybookRules(stored);
  } catch {
    return null;
  }
}
