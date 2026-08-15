import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * "One proposal produces at most one draft" — against a real database (Task 3).
 *
 * `tests/phase-10-approved-learning.test.ts` covers the same workflow with Prisma mocked out
 * entirely, and that is the reason this file exists rather than more cases being added there. A
 * mock cannot refuse a duplicate insert: it returns whatever it was told to. The guard being
 * tested here *is* a database constraint, so a suite that never reaches the database can assert
 * the service calls `createDraftVersion` with a `fromProposalId` and still be green while the
 * unique index is missing, misnamed, or dropped by a later migration.
 *
 * That is not hypothetical. The shared local database spent this branch's whole life carrying a
 * superseded lane's Phase 10 schema while `migrate status` reported "up to date", and the mocked
 * suite saw nothing.
 */

const { prisma } = await import('@/lib/prisma');
const { reviewProposal, completeApprovedProposal, ProposalError } = await import(
  '@/lib/learning/proposals'
);
const { createDraftVersion } = await import('@/lib/playbooks/versions');
const { runAs, setupWorkOrderFixture } = await import('./helpers/workOrderFixture');
type WorkOrderFixture = Awaited<ReturnType<typeof setupWorkOrderFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);

let fx: WorkOrderFixture;
const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('p10guard');
});

beforeEach(async () => {
  if (!hasDb) return;
  await run(async () => {
    // Drafts first: a version pointing at a proposal is what would block the proposal delete.
    await prisma.campaignPlaybookVersion.deleteMany({
      where: { tenantId: fx.tenantId, fromProposalId: { not: null } },
    });
    await prisma.playbookProposal.deleteMany({ where: { tenantId: fx.tenantId } });
  });
});

/** A proposal that would produce a valid policy when merged onto the fixture's active version. */
async function proposal(key: string, status: 'proposed' | 'approved' | 'rejected' = 'proposed') {
  return prisma.playbookProposal.create({
    data: {
      tenantId: fx.tenantId,
      playbookId: fx.playbookId,
      campaignId: fx.campaignId,
      basedOnVersionId: fx.versionOneId,
      proposalKey: key,
      title: 'Wait longer before giving up',
      observation: 'Positive replies arrive on day four more often than the threshold allows.',
      suggestedChange: 'Raise the positive-reply ghost threshold to five business days.',
      proposedRules: {
        ghostThresholdsBusinessDays: {
          positive_reply_waiting: 5,
          proposal_sent: 5,
          meeting_no_show: 2,
          post_demo: 5,
        },
      },
      status,
      ...(status === 'proposed'
        ? {}
        : { reviewedById: fx.directorId, reviewedAt: new Date() }),
    },
  });
}

const draftsFor = (proposalId: string) =>
  prisma.campaignPlaybookVersion.findMany({ where: { fromProposalId: proposalId } });

describe.skipIf(!hasDb)('the database refuses a second draft for one proposal', () => {
  it('an approval writes exactly one draft, linked from the version side', async () => {
    await run(async () => {
      const p = await proposal('guard-happy');
      const result = await reviewProposal({
        tenantId: fx.tenantId,
        proposalId: p.id,
        reviewerId: fx.directorId,
        decision: 'approve',
      });

      const drafts = await draftsFor(p.id);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe(result.createdVersionId);
      expect(drafts[0].status).toBe('draft');

      // The approval changed nothing that was already running. Note the in-force version reads
      // `approved` with an `activatedAt`, not a status of "active" — activation is a window, and
      // a test that asserted a status would be asserting a model this codebase does not have.
      const inForce = await prisma.campaignPlaybookVersion.findUniqueOrThrow({
        where: { id: fx.versionOneId },
      });
      expect(inForce.activatedAt).not.toBeNull();
      expect(inForce.supersededAt).toBeNull();
      expect(drafts[0].activatedAt).toBeNull();
    });
  });

  it('refuses a second draft at the constraint, not at an application check', async () => {
    await run(async () => {
      const p = await proposal('guard-second');
      await reviewProposal({
        tenantId: fx.tenantId,
        proposalId: p.id,
        reviewerId: fx.directorId,
        decision: 'approve',
      });

      // Straight at `createDraftVersion`, bypassing every service-level guard, because the point
      // is what the database does when the application's ordering fails to protect it.
      await expect(
        createDraftVersion({
          playbookId: fx.playbookId,
          tenantId: fx.tenantId,
          createdById: fx.directorId,
          rules: {
            personas: ['VP Sales'],
            valueProposition: 'A competing draft.',
            allowedCtas: ['Book 15 minutes'],
            researchDepth: 'standard',
            allowedChannels: ['email'],
            ghostThresholdsBusinessDays: {
              positive_reply_waiting: 9,
              proposal_sent: 5,
              meeting_no_show: 2,
              post_demo: 5,
            },
            handoffSlaMinutes: 60,
            sendWindow: null,
            replyHandling: { autoHandleAdministrative: true, oooResumeBufferDays: 2 },
          },
          fromProposalId: p.id,
        })
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(await draftsFor(p.id)).toHaveLength(1);
    });
  });

  it('refuses to re-decide a proposal that already has one', async () => {
    await run(async () => {
      const p = await proposal('guard-redecide');
      await reviewProposal({
        tenantId: fx.tenantId,
        proposalId: p.id,
        reviewerId: fx.directorId,
        decision: 'approve',
      });

      await expect(
        reviewProposal({
          tenantId: fx.tenantId,
          proposalId: p.id,
          reviewerId: fx.directorId,
          decision: 'approve',
        })
      ).rejects.toBeInstanceOf(ProposalError);

      expect(await draftsFor(p.id)).toHaveLength(1);
    });
  });
});

/**
 * Approved-with-no-draft — the residual failure mode the claim-first fix left behind.
 *
 * Simulated by writing the state the crash produces rather than by injecting a fault: the row is
 * what a resume actually finds, and it is reachable through more than one crash.
 */
describe.skipIf(!hasDb)('recovering an approval whose draft never got created', () => {
  it('finishes the decision without retaking it', async () => {
    await run(async () => {
      const p = await proposal('recover-basic', 'approved');
      expect(await draftsFor(p.id)).toHaveLength(0);

      const result = await completeApprovedProposal({ tenantId: fx.tenantId, proposalId: p.id });

      const drafts = await draftsFor(p.id);
      expect(drafts).toHaveLength(1);
      expect(result.createdVersionId).toBe(drafts[0].id);
      // The decision is the one already recorded — same reviewer, same status, no second claim.
      expect(result.proposal.status).toBe('approved');
      expect(drafts[0].createdById).toBe(fx.directorId);
    });
  });

  it('is idempotent: running it repeatedly converges on one draft', async () => {
    await run(async () => {
      const p = await proposal('recover-idempotent', 'approved');

      const first = await completeApprovedProposal({ tenantId: fx.tenantId, proposalId: p.id });
      const second = await completeApprovedProposal({ tenantId: fx.tenantId, proposalId: p.id });
      const third = await completeApprovedProposal({ tenantId: fx.tenantId, proposalId: p.id });

      expect(second.createdVersionId).toBe(first.createdVersionId);
      expect(third.createdVersionId).toBe(first.createdVersionId);
      expect(await draftsFor(p.id)).toHaveLength(1);
    });
  });

  it('returns the existing draft rather than a second one when the crash was later than believed', async () => {
    await run(async () => {
      const p = await proposal('recover-already-linked');
      const reviewed = await reviewProposal({
        tenantId: fx.tenantId,
        proposalId: p.id,
        reviewerId: fx.directorId,
        decision: 'approve',
      });

      const repaired = await completeApprovedProposal({
        tenantId: fx.tenantId,
        proposalId: p.id,
      });

      expect(repaired.createdVersionId).toBe(reviewed.createdVersionId);
      expect(await draftsFor(p.id)).toHaveLength(1);
    });
  });

  it('refuses a proposal nobody approved', async () => {
    await run(async () => {
      const open = await proposal('recover-open');
      const rejected = await proposal('recover-rejected', 'rejected');

      for (const p of [open, rejected]) {
        await expect(
          completeApprovedProposal({ tenantId: fx.tenantId, proposalId: p.id })
        ).rejects.toBeInstanceOf(ProposalError);
        expect(await draftsFor(p.id)).toHaveLength(0);
      }
    });
  });

  it('refuses a proposal that belongs to another tenant', async () => {
    await run(async () => {
      const p = await proposal('recover-cross-tenant', 'approved');

      await expect(
        completeApprovedProposal({ tenantId: fx.otherTenantId, proposalId: p.id })
      ).rejects.toMatchObject({ code: 'wrong_tenant' });
      expect(await draftsFor(p.id)).toHaveLength(0);
    });
  });

  it('refuses an approved proposal that records no reviewer, rather than inventing an author', async () => {
    await run(async () => {
      const p = await proposal('recover-no-reviewer', 'approved');
      await prisma.playbookProposal.update({
        where: { id: p.id },
        data: { reviewedById: null },
      });

      await expect(
        completeApprovedProposal({ tenantId: fx.tenantId, proposalId: p.id })
      ).rejects.toMatchObject({ code: 'reviewer_not_found' });
      expect(await draftsFor(p.id)).toHaveLength(0);
    });
  });
});
