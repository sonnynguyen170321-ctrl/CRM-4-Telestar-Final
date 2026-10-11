import { Prisma } from "@prisma/client";

import {
  IcpAuthoringError,
  validateManagerRules,
} from "@/lib/leadgen/icpAuthoring";
import { managerSimplificationNotes } from "@/lib/leadgen/icpManagerRules";
import { prisma } from "@/lib/prisma";

/**
 * The review workflow for a personal (custom) ICP.
 *
 * A rep's Publish does not publish: it SUBMITS the draft (`pending_review`). Nothing scores against
 * it while it waits, because the resolver only follows `published` versions. A reviewer approves it
 * (it becomes the profile's published version and the previous one is archived, in one transaction)
 * or rejects it back to a draft with a note. Authorization lives in `icpAccess`; this module does the
 * state transitions, each guarded on the status it expects so two reviewers cannot both win.
 */

const MAX_NOTE = 500;

type TransitionInput = { tenantId: string; versionId: string };

async function loadVersion(tenantId: string, versionId: string) {
  const version = await prisma.icpVersion.findFirst({
    where: { id: versionId, tenantId },
    select: {
      id: true,
      icpProfileId: true,
      status: true,
      rulesJson: true,
      updatedAt: true,
      submittedById: true,
    },
  });
  if (!version) throw new IcpAuthoringError("not_found", "ICP version not found");
  return version;
}

/** draft -> pending_review. The rules are validated as strictly as a publish would. */
export async function submitIcpDraftForReview(
  input: TransitionInput & { submittedById: string; expectedUpdatedAt: string },
) {
  const current = await loadVersion(input.tenantId, input.versionId);
  if (current.status === "pending_review") {
    throw new IcpAuthoringError("review_pending", "This version is already waiting for review");
  }
  if (current.status !== "draft") {
    throw new IcpAuthoringError("published_immutable", "Only drafts can be submitted for review");
  }
  if (managerSimplificationNotes(current.rulesJson).length) {
    throw new IcpAuthoringError(
      "simplification_required",
      "Save and confirm legacy-rule simplification before submitting",
    );
  }
  validateManagerRules(current.rulesJson, true);

  const result = await prisma.icpVersion.updateMany({
    where: {
      id: current.id,
      tenantId: input.tenantId,
      status: "draft",
      updatedAt: new Date(input.expectedUpdatedAt),
    },
    data: {
      status: "pending_review",
      submittedById: input.submittedById,
      submittedAt: new Date(),
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    },
  });
  if (result.count !== 1) {
    throw new IcpAuthoringError(
      "draft_conflict",
      "This draft changed in another session. Reload before submitting.",
    );
  }
  return prisma.icpVersion.findFirstOrThrow({ where: { id: current.id, tenantId: input.tenantId } });
}

const CHANGED = "This ICP changed since you opened it (it was withdrawn and resubmitted). Reload and review it again.";

/**
 * The reviewer decides on the submission they SAW. A rep can withdraw, edit and resubmit between the
 * reviewer opening the queue and pressing Approve; `submittedAt` is new on every submission, so
 * binding the decision to it turns that swap into a conflict instead of an approval of rules nobody read.
 */
const sameSubmission = (expectedSubmittedAt: string) => new Date(expectedSubmittedAt);

/**
 * pending_review -> published; the profile's previous published version is archived with it.
 * Returns the ids it archived, for the audit row.
 */
export async function approveIcpVersion(
  input: TransitionInput & { reviewerId: string; expectedSubmittedAt: string },
) {
  const current = await loadVersion(input.tenantId, input.versionId);
  if (current.status !== "pending_review") {
    throw new IcpAuthoringError("not_pending", "This version is not waiting for review");
  }
  const rules = validateManagerRules(current.rulesJson, true);

  return prisma.$transaction(async (tx) => {
      // Archive first: the database allows one published version per profile, so the old one must
      // leave before the new one arrives. Rolled back with the rest if the claim below fails.
      const previous = await tx.icpVersion.findMany({
        where: {
          tenantId: input.tenantId,
          icpProfileId: current.icpProfileId,
          status: "published",
          id: { not: current.id },
        },
        select: { id: true },
      });
      await tx.icpVersion.updateMany({
        where: { id: { in: previous.map((row) => row.id) }, tenantId: input.tenantId, status: "published" },
        data: { status: "archived" },
      });
      const claimed = await tx.icpVersion.updateMany({
        where: {
          id: current.id,
          tenantId: input.tenantId,
          status: "pending_review",
          submittedAt: sameSubmission(input.expectedSubmittedAt),
        },
        data: {
          status: "published",
          publishedAt: new Date(),
          reviewedById: input.reviewerId,
          reviewedAt: new Date(),
          reviewNote: null,
          rulesJson: rules as unknown as Prisma.InputJsonValue,
        },
      });
      if (claimed.count !== 1) {
        // Either decided already or swapped for a newer submission: say which.
        const now = await tx.icpVersion.findFirst({
          where: { id: current.id, tenantId: input.tenantId },
          select: { status: true },
        });
        throw now?.status === "pending_review"
          ? new IcpAuthoringError("changed_since_opened", CHANGED)
          : new IcpAuthoringError("not_pending", "This version was already decided");
      }
      const version = await tx.icpVersion.findFirstOrThrow({ where: { id: current.id, tenantId: input.tenantId } });
      return { version, archivedVersionIds: previous.map((row) => row.id) };
  });
}

/** pending_review -> draft, with the reason. The rep edits and submits again. */
export async function rejectIcpVersion(
  input: TransitionInput & { reviewerId: string; note: string; expectedSubmittedAt: string },
) {
  const note = input.note.trim();
  if (note.length < 3 || note.length > MAX_NOTE) {
    throw new IcpAuthoringError("invalid_rules", "Tell the rep what to change (3 to 500 characters)");
  }
  const result = await prisma.icpVersion.updateMany({
    where: {
      id: input.versionId,
      tenantId: input.tenantId,
      status: "pending_review",
      submittedAt: sameSubmission(input.expectedSubmittedAt),
    },
    data: {
      status: "draft",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      reviewNote: note,
    },
  });
  if (result.count !== 1) {
    const now = await prisma.icpVersion.findFirst({
      where: { id: input.versionId, tenantId: input.tenantId },
      select: { status: true },
    });
    if (!now) throw new IcpAuthoringError("not_found", "ICP version not found");
    throw now.status === "pending_review"
      ? new IcpAuthoringError("changed_since_opened", CHANGED)
      : new IcpAuthoringError("not_pending", "This version is not waiting for review");
  }
  return prisma.icpVersion.findFirstOrThrow({ where: { id: input.versionId, tenantId: input.tenantId } });
}

/** pending_review -> draft by the submitter, who changed their mind. No review note: nobody rejected it. */
export async function withdrawIcpSubmission(input: TransitionInput) {
  const result = await prisma.icpVersion.updateMany({
    where: { id: input.versionId, tenantId: input.tenantId, status: "pending_review" },
    data: { status: "draft", submittedAt: null, submittedById: null },
  });
  if (result.count !== 1) {
    throw new IcpAuthoringError("not_pending", "This version is not waiting for review");
  }
  return prisma.icpVersion.findFirstOrThrow({ where: { id: input.versionId, tenantId: input.tenantId } });
}
