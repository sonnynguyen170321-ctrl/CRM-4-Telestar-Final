"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/server/prisma";
import {
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
} from "@/lib/v2/outreach/campaigns/campaignRuntime";
import {
  isValidIanaTimezone,
  validateCampaignSchedule,
} from "@/lib/v2/outreach/campaigns/schedule";
import type {
  V2CampaignScheduleV1,
  V2CampaignTimezoneMode,
} from "@/lib/v2/outreach/campaigns/types";
import {
  moveStep,
  removeStep,
  updateStep,
  type SequenceAuthorDb,
} from "@/lib/v2/outreach/sequences/authorSequence";
import { requirePermission } from "@/lib/v2/tenant";

export async function saveCampaignVariantAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const stepId = required(formData, "stepId");
  const variantId = required(formData, "variantId");
  const weight = integer(formData, "weight", 1, 10_000);
  const subjectTemplate = optional(formData, "subjectTemplate");
  const bodyTemplate = optional(formData, "bodyTemplate");
  const requiredVariables = optional(formData, "requiredVariables")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

  await assertDraftStep(context.organizationId, campaignId, stepId);
  const updated = await prisma.v2SequenceStepVariant.updateMany({
    where: {
      id: variantId,
      organizationId: context.organizationId,
      sequenceStepId: stepId,
    },
    data: {
      weight,
      subjectTemplate,
      bodyTemplate,
      requiredVariablesJson: requiredVariables,
    },
  });
  if (updated.count !== 1) throw new Error("Campaign variant not found.");
  refresh(campaignId);
  redirect(campaignHref(campaignId, "sequence", "variant-saved"));
}

const VARIANT_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// W7: add an A/B variant to an existing draft email step. Picks the next free variant key
// and a neutral weight so the deterministic weighted assignment splits traffic evenly
// until the rep tunes it. Draft-gated; the unique (org, step, key) constraint is honoured.
export async function addCampaignVariantAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const stepId = required(formData, "stepId");
  await assertDraftStep(context.organizationId, campaignId, stepId);

  const existing = await prisma.v2SequenceStepVariant.findMany({
    where: { organizationId: context.organizationId, sequenceStepId: stepId },
    select: { variantKey: true },
  });
  const used = new Set(existing.map((variant) => variant.variantKey));
  const nextKey = VARIANT_KEYS.find((key) => !used.has(key));
  if (!nextKey) {
    redirect(campaignHref(campaignId, "sequence", "variant-limit", ["A step can have at most 26 variants."]));
  }
  await prisma.v2SequenceStepVariant.create({
    data: {
      organizationId: context.organizationId,
      sequenceStepId: stepId,
      variantKey: nextKey,
      name: "Variant " + nextKey,
      weight: 100,
      enabled: true,
      subjectTemplate: "",
      bodyTemplate: "",
      requiredVariablesJson: [],
    },
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "sequence", "variant-added"));
}

// W7: remove a variant from a draft step. A step must keep at least one variant (the send
// path always needs a template), so the last one is protected. Hard delete is safe here -
// the step is draft, pre-launch, with no enrollments referencing the variant for a send.
export async function deleteCampaignVariantAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const stepId = required(formData, "stepId");
  const variantId = required(formData, "variantId");
  await assertDraftStep(context.organizationId, campaignId, stepId);

  const count = await prisma.v2SequenceStepVariant.count({
    where: { organizationId: context.organizationId, sequenceStepId: stepId },
  });
  if (count <= 1) {
    redirect(campaignHref(campaignId, "sequence", "variant-last", ["A step must keep at least one variant."]));
  }
  const deleted = await prisma.v2SequenceStepVariant.deleteMany({
    where: { id: variantId, organizationId: context.organizationId, sequenceStepId: stepId },
  });
  if (deleted.count !== 1) throw new Error("Campaign variant not found.");
  refresh(campaignId);
  redirect(campaignHref(campaignId, "sequence", "variant-removed"));
}

export async function addCampaignEmailStepAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.v2Sequence.findFirst({
      where: {
        id: campaignId,
        organizationId: context.organizationId,
        status: "DRAFT",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!campaign) throw new Error("Only a draft campaign can add steps.");
    const aggregate = await tx.v2SequenceStep.aggregate({
      where: { organizationId: context.organizationId, sequenceId: campaignId },
      _max: { ordinal: true },
    });
    const step = await tx.v2SequenceStep.create({
      data: {
        organizationId: context.organizationId,
        sequenceId: campaignId,
        ordinal: (aggregate._max.ordinal ?? 0) + 1,
        kind: "EMAIL",
        delayMinutes: 0,
      },
    });
    await tx.v2SequenceStepVariant.create({
      data: {
        organizationId: context.organizationId,
        sequenceStepId: step.id,
        variantKey: "A",
        name: "Primary",
        weight: 100,
        enabled: true,
        subjectTemplate: "",
        bodyTemplate: "",
        requiredVariablesJson: [],
      },
    });
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "sequence", "step-added"));
}

// Step CRUD in the campaign workspace — REUSES the proven authorSequence mutations
// (Lemlist-grade editing: per-step delay, delete, reorder). Draft-gated inside the lib.
export async function updateCampaignStepDelayAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const stepId = required(formData, "stepId");
  const delayMinutes = integer(formData, "delayMinutes", 0, 60 * 24 * 90); // up to 90 days
  // updateStep writes subject/body too — pass the current values through so a delay edit
  // never nulls a legacy step-level template.
  const step = await prisma.v2SequenceStep.findFirst({
    where: { id: stepId, organizationId: context.organizationId, sequenceId: campaignId },
    select: { subjectTemplate: true, bodyTemplate: true },
  });
  if (!step) throw new Error("Campaign step not found.");
  await updateStep(prisma as unknown as SequenceAuthorDb, {
    organizationId: context.organizationId,
    sequenceId: campaignId,
    stepId,
    delayMinutes,
    subjectTemplate: step.subjectTemplate,
    bodyTemplate: step.bodyTemplate,
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "sequence", "step-delay-saved"));
}

export async function removeCampaignStepAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const stepId = required(formData, "stepId");
  await removeStep(prisma as unknown as SequenceAuthorDb, {
    organizationId: context.organizationId,
    sequenceId: campaignId,
    stepId,
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "sequence", "step-removed"));
}

export async function moveCampaignStepAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const stepId = required(formData, "stepId");
  const direction = required(formData, "direction") === "up" ? "up" : "down";
  await moveStep(prisma as unknown as SequenceAuthorDb, {
    organizationId: context.organizationId,
    sequenceId: campaignId,
    stepId,
    direction,
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "sequence", "step-moved"));
}

export async function saveCampaignScheduleAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const weekdays = formData
    .getAll("weekdays")
    .map(Number)
    .filter((day): day is 1 | 2 | 3 | 4 | 5 | 6 | 7 =>
      Number.isInteger(day) && day >= 1 && day <= 7
    );
  const schedule: V2CampaignScheduleV1 = {
    schemaVersion: "v2.campaign-schedule.v1",
    weekdays,
    startLocalTime: required(formData, "startLocalTime"),
    endLocalTime: required(formData, "endLocalTime"),
  };
  const errors = validateCampaignSchedule(schedule);
  const timezoneMode = required(formData, "timezoneMode") as V2CampaignTimezoneMode;
  if (!["LEAD", "CAMPAIGN", "ORGANIZATION"].includes(timezoneMode)) {
    errors.push("Timezone mode is invalid.");
  }
  const fallbackTimezone = required(formData, "fallbackTimezone");
  if (!isValidIanaTimezone(fallbackTimezone)) {
    errors.push("Fallback timezone must be a valid IANA timezone.");
  }
  if (errors.length > 0) {
    redirect(campaignHref(campaignId, "schedule", "schedule-invalid", errors));
  }
  // Schedule is editable while DRAFT or PAUSED — the send window only affects FUTURE
  // sends, and the paused-edit-resume flow needs it (this was the "can't set schedule"
  // bug: the editor shows for PAUSED but the save was gated to DRAFT only).
  const updated = await prisma.v2Sequence.updateMany({
    where: {
      id: campaignId,
      organizationId: context.organizationId,
      status: { in: ["DRAFT", "PAUSED"] },
      deletedAt: null,
    },
    data: {
      scheduleJson: schedule,
      timezoneMode,
      fallbackTimezone,
    },
  });
  if (updated.count !== 1) throw new Error("Only a draft or paused campaign schedule can be edited.");
  refresh(campaignId);
  redirect(campaignHref(campaignId, "schedule", "schedule-saved"));
}

export async function saveCampaignSettingsAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const name = required(formData, "name");
  const description = optional(formData, "description");
  const maxTouchesRaw = optional(formData, "maxTouches");
  const maxTouches = maxTouchesRaw ? integerValue(maxTouchesRaw, 1, 100) : null;
  const updated = await prisma.v2Sequence.updateMany({
    where: {
      id: campaignId,
      organizationId: context.organizationId,
      status: { in: ["DRAFT", "PAUSED"] },
      deletedAt: null,
    },
    data: {
      name,
      description,
      stopOnReply: formData.get("stopOnReply") === "on",
      stopOnBounce: formData.get("stopOnBounce") === "on",
      stopOnMeeting: formData.get("stopOnMeeting") === "on",
      trackingEnabled: formData.get("trackingEnabled") === "on",
      maxTouches,
    },
  });
  if (updated.count !== 1) throw new Error("Only a draft or paused campaign can edit settings.");
  refresh(campaignId);
  redirect(campaignHref(campaignId, "settings", "settings-saved"));
}

export async function launchCampaignAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  if (formData.get("confirmLaunch") !== "yes") {
    redirect(campaignHref(campaignId, "review", "launch-confirmation-required"));
  }
  const leadIds = Array.from(
    new Set(formData.getAll("leadId").map(String).filter(Boolean))
  );
  const result = await launchCampaign(prisma, {
    organizationId: context.organizationId,
    campaignId,
    actorUserId: context.userId,
    idempotencyKey: optional(formData, "idempotencyKey") ?? randomUUID(),
    selections: leadIds.map((leadAssignmentId) => ({
      leadAssignmentId,
      overrideReason: optional(formData, "override:" + leadAssignmentId),
    })),
  });
  refresh(campaignId);
  if (!result.launched) {
    redirect(
      campaignHref(
        campaignId,
        "review",
        "launch-blocked",
        result.blockers.map((blocker) => blocker.message)
      )
    );
  }
  redirect(campaignHref(campaignId, "operations", result.alreadyActive ? "already-active" : "launched"));
}

export async function pauseCampaignAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  await pauseCampaign(prisma, {
    organizationId: context.organizationId,
    campaignId,
    actorUserId: context.userId,
    idempotencyKey: optional(formData, "idempotencyKey") ?? randomUUID(),
    reason: optional(formData, "reason") ?? "Paused from campaign workspace",
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "operations", "paused"));
}

export async function resumeCampaignAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  await resumeCampaign(prisma, {
    organizationId: context.organizationId,
    campaignId,
    actorUserId: context.userId,
    idempotencyKey: optional(formData, "idempotencyKey") ?? randomUUID(),
    reason: optional(formData, "reason") ?? "Resumed from campaign workspace",
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "operations", "resumed"));
}


export async function saveCampaignSenderPoolAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const poolId = required(formData, "poolId");
  const weight = integer(formData, "weight", 1, 10_000);
  const enabled = formData.get("enabled") === "on";
  const updated = await prisma.v2SequenceSenderAccount.updateMany({
    where: {
      id: poolId,
      organizationId: context.organizationId,
      sequenceId: campaignId,
    },
    data: {
      weight,
      enabled,
    },
  });
  if (updated.count !== 1) throw new Error("Sender pool row not found.");
  refresh(campaignId);
  redirect(campaignHref(campaignId, "senders", "sender-pool-updated"));
}
export async function addCampaignSenderToPoolAction(formData: FormData) {
  const context = await requirePermission("outreach.admin");
  const campaignId = required(formData, "campaignId");
  const senderAccountId = required(formData, "senderAccountId");

  const campaign = await prisma.v2Sequence.findFirst({
    where: {
      id: campaignId,
      organizationId: context.organizationId,
      status: { in: ["DRAFT", "PAUSED"] },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!campaign) throw new Error("Only a draft or paused campaign can edit sender pool.");

  const sender = await prisma.v2SenderAccount.findFirst({
    where: {
      id: senderAccountId,
      organizationId: context.organizationId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!sender) throw new Error("Sender account not found.");

  await prisma.v2SequenceSenderAccount.upsert({
    where: {
      organizationId_sequenceId_senderAccountId: {
        organizationId: context.organizationId,
        sequenceId: campaignId,
        senderAccountId,
      },
    },
    update: {
      enabled: true,
      weight: 100,
    },
    create: {
      organizationId: context.organizationId,
      sequenceId: campaignId,
      senderAccountId,
      enabled: true,
      weight: 100,
      createdByUserId: context.userId,
    },
  });
  refresh(campaignId);
  redirect(campaignHref(campaignId, "settings", "sender-added"));
}

async function assertDraftStep(
  organizationId: string,
  campaignId: string,
  stepId: string
) {
  const step = await prisma.v2SequenceStep.findFirst({
    where: {
      id: stepId,
      organizationId,
      sequenceId: campaignId,
    },
    select: { id: true },
  });
  const campaign = await prisma.v2Sequence.findFirst({
    where: {
      id: campaignId,
      organizationId,
      status: "DRAFT",
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!step || !campaign) throw new Error("Only draft campaign steps can be edited.");
}

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(key + " is required.");
  return value;
}

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function integer(
  formData: FormData,
  key: string,
  minimum: number,
  maximum: number
) {
  const value = Number(required(formData, key));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(key + " is invalid.");
  }
  return value;
}

function integerValue(value: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("number value is invalid.");
  }
  return parsed;
}

function campaignHref(
  campaignId: string,
  stage: string,
  notice: string,
  errors: string[] = []
) {
  const params = new URLSearchParams({ stage, notice, tab: tabForStage(stage) });
  for (const error of errors.slice(0, 8)) params.append("error", error);
  return "/v2/outreach/campaigns/" + campaignId + "?" + params.toString();
}

function tabForStage(stage: string) {
  if (stage === "schedule" || stage === "senders" || stage === "settings") return "settings";
  if (stage === "operations") return "contacts";
  return "editor";
}

function refresh(campaignId: string) {
  revalidatePath("/v2/outreach/campaigns");
  revalidatePath("/v2/outreach/campaigns/" + campaignId);
}
