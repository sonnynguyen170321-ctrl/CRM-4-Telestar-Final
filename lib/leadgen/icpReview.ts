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

/** pending_review -> published; the profile's previous published version is archived with it. */
export async function approveIcpVersion(input: TransitionInput & { reviewerId: string }) {
  const current = await loadVersion(input.tenantId, input.versionId);
  if (current.status !== "pending_review") {
    throw new IcpAuthoringError("not_pending", "This version is not waiting for review");
  }
  const rules = validateManagerRules(current.rulesJson, true);

  return prisma.$transaction(async (tx) => {
      const claimed = await tx.icpVersion.updateMany({
        where: { id: current.id, tenantId: input.tenantId, status: "pending_review" },
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
        throw new IcpAuthoringError("not_pending", "This version was already decided");
      }
      await tx.icpVersion.updateMany({
        where: {
          tenantId: input.tenantId,
          icpProfileId: current.icpProfileId,
          status: "published",
          id: { not: current.id },
        },
        data: { status: "archived" },
      });
      return tx.icpVersion.findFirstOrThrow({ where: { id: current.id, tenantId: input.tenantId } });
  });
}

/** pending_review -> draft, with the reason. The rep edits and submits again. */
export async function rejectIcpVersion(
  input: TransitionInput & { reviewerId: string; note: string },
) {
  const note = input.note.trim();
  if (note.length < 3 || note.length > MAX_NOTE) {
    throw new IcpAuthoringError("invalid_rules", "Tell the rep what to change (3 to 500 characters)");
  }
  const result = await prisma.icpVersion.updateMany({
    where: { id: input.versionId, tenantId: input.tenantId, status: "pending_review" },
    data: {
      status: "draft",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      reviewNote: note,
    },
  });
  if (result.count !== 1) {
    const exists = await prisma.icpVersion.findFirst({
      where: { id: input.versionId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!exists) throw new IcpAuthoringError("not_found", "ICP version not found");
    throw new IcpAuthoringError("not_pending", "This version is not waiting for review");
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
