import "server-only";

import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import { recordAuditEvent } from "@/lib/v2/audit";

// Campaign lifecycle (Instantly/Lemlist-grade list CRUD): rename, duplicate, archive,
// soft-delete. Tenant-scoped from the caller's session org (Inv 5); soft-delete only
// (Inv 8 — deletedAt, never a hard DELETE); every mutation audited. Rules:
// - rename: any non-deleted campaign.
// - duplicate: copies steps + variants + sender pool + settings into a NEW DRAFT " (copy)";
//   never copies enrollments/messages (those belong to the source's sends).
// - archive: DRAFT | PAUSED | (ACTIVE blocked — pause first) -> ARCHIVED.
// - delete: DRAFT | ARCHIVED only (a launched campaign must be archived first so its send
//   history stays reachable), sets deletedAt.

export type CampaignLifecycleDb = PrismaClient | Prisma.TransactionClient;

type Ctx = { organizationId: string; actorUserId: string };

type Result = { ok: true } | { ok: false; error: string };
type DuplicateResult = { ok: true; campaignId: string } | { ok: false; error: string };

async function loadCampaign(db: CampaignLifecycleDb, ctx: Ctx, campaignId: string) {
  return db.v2Sequence.findFirst({
    where: { id: campaignId, organizationId: ctx.organizationId, deletedAt: null },
  });
}

export async function renameCampaign(
  db: CampaignLifecycleDb,
  ctx: Ctx,
  input: { campaignId: string; name: string }
): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Campaign name is required." };
  if (name.length > 200) return { ok: false, error: "Campaign name is too long." };

  const updated = await db.v2Sequence.updateMany({
    where: { id: input.campaignId, organizationId: ctx.organizationId, deletedAt: null },
    data: { name },
  });
  if (updated.count !== 1) return { ok: false, error: "Campaign not found." };

  await recordAuditEvent(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    eventType: "campaign.renamed",
    entityType: "V2Sequence",
    entityId: input.campaignId,
    metadataJson: { name },
  });
  return { ok: true };
}

export async function archiveCampaign(
  db: CampaignLifecycleDb,
  ctx: Ctx,
  input: { campaignId: string }
): Promise<Result> {
  const campaign = await loadCampaign(db, ctx, input.campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status === "ACTIVE") {
    return { ok: false, error: "Pause the campaign before archiving it." };
  }
  if (campaign.status === "ARCHIVED") return { ok: true }; // idempotent

  await db.v2Sequence.updateMany({
    where: { id: input.campaignId, organizationId: ctx.organizationId, deletedAt: null },
    data: { status: "ARCHIVED" },
  });
  await recordAuditEvent(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    eventType: "campaign.archived",
    entityType: "V2Sequence",
    entityId: input.campaignId,
    metadataJson: { from: campaign.status },
  });
  return { ok: true };
}

export async function deleteCampaign(
  db: CampaignLifecycleDb,
  ctx: Ctx,
  input: { campaignId: string }
): Promise<Result> {
  const campaign = await loadCampaign(db, ctx, input.campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.status !== "DRAFT" && campaign.status !== "ARCHIVED") {
    return { ok: false, error: "Only a draft or archived campaign can be deleted. Archive it first." };
  }

  await db.v2Sequence.updateMany({
    where: { id: input.campaignId, organizationId: ctx.organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  await recordAuditEvent(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    eventType: "campaign.deleted",
    entityType: "V2Sequence",
    entityId: input.campaignId,
    metadataJson: { status: campaign.status },
  });
  return { ok: true };
}

export async function duplicateCampaign(
  db: PrismaClient,
  ctx: Ctx,
  input: { campaignId: string }
): Promise<DuplicateResult> {
  const source = await loadCampaign(db, ctx, input.campaignId);
  if (!source) return { ok: false, error: "Campaign not found." };

  const campaignId = await db.$transaction(async (tx) => {
    const copy = await tx.v2Sequence.create({
      data: {
        organizationId: ctx.organizationId,
        name: `${source.name} (copy)`.slice(0, 200),
        description: source.description,
        status: "DRAFT",
        stopOnReply: source.stopOnReply,
        stopOnBounce: source.stopOnBounce,
        stopOnMeeting: source.stopOnMeeting,
        maxTouches: source.maxTouches,
        scheduleJson: source.scheduleJson ?? undefined,
        timezoneMode: source.timezoneMode,
        fallbackTimezone: source.fallbackTimezone,
        trackingEnabled: source.trackingEnabled,
        createdByUserId: ctx.actorUserId,
      },
      select: { id: true },
    });

    const steps = await tx.v2SequenceStep.findMany({
      where: { organizationId: ctx.organizationId, sequenceId: source.id },
      orderBy: { ordinal: "asc" },
    });
    for (const step of steps) {
      const newStep = await tx.v2SequenceStep.create({
        data: {
          organizationId: ctx.organizationId,
          sequenceId: copy.id,
          ordinal: step.ordinal,
          kind: step.kind,
          delayMinutes: step.delayMinutes,
          sendWindowJson: step.sendWindowJson ?? undefined,
          subjectTemplate: step.subjectTemplate,
          bodyTemplate: step.bodyTemplate,
          branchConfigJson: step.branchConfigJson ?? undefined,
        },
        select: { id: true },
      });
      const variants = await tx.v2SequenceStepVariant.findMany({
        where: { organizationId: ctx.organizationId, sequenceStepId: step.id },
        orderBy: { variantKey: "asc" },
      });
      if (variants.length > 0) {
        await tx.v2SequenceStepVariant.createMany({
          data: variants.map((variant) => ({
            organizationId: ctx.organizationId,
            sequenceStepId: newStep.id,
            variantKey: variant.variantKey,
            name: variant.name,
            weight: variant.weight,
            enabled: variant.enabled,
            subjectTemplate: variant.subjectTemplate,
            bodyTemplate: variant.bodyTemplate,
            requiredVariablesJson: (variant.requiredVariablesJson ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        });
      }
    }

    const pool = await tx.v2SequenceSenderAccount.findMany({
      where: { organizationId: ctx.organizationId, sequenceId: source.id },
    });
    if (pool.length > 0) {
      await tx.v2SequenceSenderAccount.createMany({
        data: pool.map((row) => ({
          organizationId: ctx.organizationId,
          sequenceId: copy.id,
          senderAccountId: row.senderAccountId,
          enabled: row.enabled,
          weight: row.weight,
          createdByUserId: ctx.actorUserId,
        })),
      });
    }

    return copy.id;
  });

  await recordAuditEvent(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    eventType: "campaign.duplicated",
    entityType: "V2Sequence",
    entityId: campaignId,
    metadataJson: { sourceCampaignId: input.campaignId },
  });
  return { ok: true, campaignId };
}
