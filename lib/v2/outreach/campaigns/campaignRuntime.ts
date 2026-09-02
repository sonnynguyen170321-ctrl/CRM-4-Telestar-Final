import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

import { extractDomainIdentifier, normalizeEmailIdentifier } from "../suppression/normalizeIdentifier";
import { selectSender, type SenderForSelection } from "../senderPool/policy";
import { decideCampaignLeadEligibility, prioritizeCampaignLeads } from "./eligibility";
import { findUnresolvedRequiredVariables, renderCampaignTemplate } from "./rendering";
import { nextCampaignWindow, resolveCampaignTimezone, validateCampaignSchedule } from "./schedule";
import { evaluateHeartbeat } from "../worker/heartbeat";
import type {
  V2CampaignScheduleV1,
  V2CampaignTimezoneMode,
  V2EnrollmentRenderSnapshotV1,
  V2LeadOutreachMergeDataV1,
} from "./types";

export type CampaignLaunchSelection = {
  leadAssignmentId: string;
  overrideReason?: string | null;
};

export type CampaignLaunchBlocker = {
  code:
    | "CAMPAIGN_NOT_FOUND"
    | "CAMPAIGN_NOT_DRAFT"
    | "NO_LEADS_SELECTED"
    | "INVALID_EMAIL"
    | "SUPPRESSED"
    | "OVERRIDE_REQUIRED"
    | "NO_EMAIL_STEP"
    | "INVALID_TEMPLATE"
    | "REQUIRED_VARIABLE_MISSING"
    | "INVALID_SCHEDULE"
    | "NO_HEALTHY_LIVE_SENDER"
    | "TRACKING_DOMAIN_UNVERIFIED"
    | "GLOBAL_KILL_SWITCH_ENABLED"
    | "WORKER_UNHEALTHY";
  message: string;
  leadAssignmentId?: string;
  stepId?: string;
};

export type CampaignLaunchResult = {
  launched: boolean;
  alreadyActive: boolean;
  campaignId: string;
  enrolled: number;
  existing: number;
  blockers: CampaignLaunchBlocker[];
};

type RuntimeDb = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;

type PreparedLead = {
  leadAssignmentId: string;
  contactId: string;
  profileId: string | null;
  qualification: "QUALIFIED" | "NEEDS_REVIEW" | "UNQUALIFIED" | "NOT_SCORED";
  fitScore: number | null;
  email: string;
  timezone: string;
  snapshot: V2EnrollmentRenderSnapshotV1;
  fingerprint: string;
  overrideReason: string | null;
};

type RuntimeSender = SenderForSelection & {
  liveSendEnabled: boolean;
  trackingStatus: string | null;
};

export async function launchCampaign(
  db: RuntimeDb,
  input: {
    organizationId: string;
    campaignId: string;
    actorUserId: string;
    selections: readonly CampaignLaunchSelection[];
    idempotencyKey: string;
    organizationTimezone?: string | null;
    now?: Date;
  }
): Promise<CampaignLaunchResult> {
  assertLifecycleInput(input);
  const now = input.now ?? new Date();
  const selections = uniqueSelections(input.selections);
  return db.$transaction(async (tx) => {
    await lockCampaign(tx, input.organizationId, input.campaignId);
    const campaign = await tx.v2Sequence.findFirst({
      where: { id: input.campaignId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!campaign) return blocked(input.campaignId, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
    if (campaign.status === "ACTIVE") {
      const existing = await tx.v2SequenceEnrollment.count({
        where: { organizationId: input.organizationId, sequenceId: input.campaignId, deletedAt: null },
      });
      return {
        launched: true,
        alreadyActive: true,
        campaignId: input.campaignId,
        enrolled: 0,
        existing,
        blockers: [],
      };
    }
    if (campaign.status !== "DRAFT") {
      return blocked(input.campaignId, "CAMPAIGN_NOT_DRAFT", "Only a draft campaign can launch.");
    }

    const schedule = campaign.scheduleJson as V2CampaignScheduleV1 | null;
    const blockers: CampaignLaunchBlocker[] = [];
    if (process.env.V2_OUTREACH_KILL_SWITCH === "1") {
      blockers.push({ code: "GLOBAL_KILL_SWITCH_ENABLED", message: "Global outreach kill switch is enabled." });
    }
    // A live launch requires a healthy job-worker heartbeat (the UI is not the
    // scheduler). Tolerated in dev (no daemon); enforced in production.
    if (process.env.NODE_ENV === "production") {
      const hbRows = await tx.$queryRawUnsafe<Array<{ lastBeatAt: Date }>>(
        `SELECT "lastBeatAt" FROM "V2WorkerHeartbeat" WHERE "workerKind" = 'job_worker' LIMIT 1`
      );
      if (!evaluateHeartbeat(hbRows[0]?.lastBeatAt ?? null, { isProduction: true }).healthy) {
        blockers.push({
          code: "WORKER_UNHEALTHY",
          message: "The job-worker heartbeat is stale or missing; the daemon must be live before launching.",
        });
      }
    }
    if (selections.length === 0) {
      blockers.push({ code: "NO_LEADS_SELECTED", message: "Select at least one lead." });
    }
    const scheduleErrors = validateCampaignSchedule(schedule);
    if (scheduleErrors.length > 0) {
      blockers.push({ code: "INVALID_SCHEDULE", message: scheduleErrors.join(" ") });
    }

    const campaignSteps = await tx.v2SequenceStep.findMany({
      where: { organizationId: input.organizationId, sequenceId: input.campaignId },
      orderBy: { ordinal: "asc" },
    });
    const emailSteps = campaignSteps.filter((step) => step.kind === "EMAIL");
    const variants = await tx.v2SequenceStepVariant.findMany({
      where: {
        organizationId: input.organizationId,
        sequenceStepId: { in: emailSteps.map((step) => step.id) },
        enabled: true,
        weight: { gt: 0 },
      },
      orderBy: [{ sequenceStepId: "asc" }, { variantKey: "asc" }],
    });
    if (emailSteps.length === 0 || variants.length === 0) {
      blockers.push({ code: "NO_EMAIL_STEP", message: "Campaign needs an enabled email variant." });
    }
    for (const variant of variants) {
      if (!variant.bodyTemplate?.trim()) {
        blockers.push({
          code: "INVALID_TEMPLATE",
          message: "Every email variant requires a body.",
          stepId: variant.sequenceStepId,
        });
      }
    }

    const senders = await loadSenders(tx, input.organizationId, input.campaignId, now);
    const liveSenders = senders.filter((sender) => sender.liveSendEnabled);
    const eligibleSenders = liveSenders.filter((sender) => selectSender([sender]) !== null);
    if (eligibleSenders.length === 0) {
      blockers.push({
        code: "NO_HEALTHY_LIVE_SENDER",
        message: "No healthy live sender has remaining daily capacity.",
      });
    }
    if (
      campaign.trackingEnabled &&
      eligibleSenders.some((sender) => sender.trackingStatus !== "VERIFIED")
    ) {
      blockers.push({
        code: "TRACKING_DOMAIN_UNVERIFIED",
        message: "Every live campaign sender needs a verified tracking domain.",
      });
    }

    const prepared: PreparedLead[] = [];
    for (const selection of selections) {
      const item = await prepareLead(tx, {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        timezoneMode: campaign.timezoneMode,
        fallbackTimezone: campaign.fallbackTimezone,
        organizationTimezone: input.organizationTimezone,
        selection,
        variants,
        now,
      });
      blockers.push(...item.blockers);
      if (item.lead) prepared.push(item.lead);
    }
    if (blockers.length > 0 || !schedule) {
      return {
        launched: false,
        alreadyActive: false,
        campaignId: input.campaignId,
        enrolled: 0,
        existing: 0,
        blockers,
      };
    }

    let enrolled = 0;
    let existing = 0;
    const virtualSenders = eligibleSenders.map((sender) => ({ ...sender }));
    const ordered = prioritizeCampaignLeads(
      prepared.map((lead) => ({
        ...lead,
        email: lead.email,
        suppressed: false,
      }))
    );
    for (const lead of ordered) {
      const found = await tx.v2SequenceEnrollment.findFirst({
        where: {
          organizationId: input.organizationId,
          sequenceId: input.campaignId,
          leadAssignmentId: lead.leadAssignmentId,
        },
        select: { id: true },
      });
      if (found) {
        existing++;
        continue;
      }
      const sender = selectSender(virtualSenders);
      if (!sender) {
        throw new CampaignCapacityChangedError(lead.leadAssignmentId);
      }
      sender.sentToday++;
      const firstStepAt = nextCampaignWindow(now, schedule, lead.timezone);
      const enrollment = await tx.v2SequenceEnrollment.create({
        data: {
          id: generateId("enr"),
          organizationId: input.organizationId,
          sequenceId: input.campaignId,
          leadAssignmentId: lead.leadAssignmentId,
          contactId: lead.contactId,
          senderAccountId: sender.id,
          status: "ACTIVE",
          currentStepOrdinal: campaignSteps[0]?.ordinal ?? 1,
          nextStepAt: firstStepAt,
          outreachProfileId: lead.profileId,
          recipientEmailSnapshot: lead.email,
          timezoneSnapshot: lead.timezone,
          renderContextSnapshotJson: lead.snapshot as unknown as Prisma.InputJsonValue,
          outreachProfileFingerprint: lead.fingerprint,
          qualificationOverrideReason: lead.overrideReason,
          qualificationOverrideByUserId: lead.overrideReason ? input.actorUserId : null,
          qualificationOverrideAt: lead.overrideReason ? now : null,
          enrolledByUserId: input.actorUserId,
        },
      });
      enrolled++;
      if (lead.overrideReason) {
        await writeAudit(tx, {
          organizationId: input.organizationId,
          sequenceId: input.campaignId,
          leadAssignmentId: lead.leadAssignmentId,
          actorUserId: input.actorUserId,
          eventKind: "campaign.qualification_override",
          reason: lead.overrideReason,
          idempotencyKey: "qualification-override:" + enrollment.id,
        });
      }
    }

    await tx.v2Sequence.updateMany({
      where: {
        id: input.campaignId,
        organizationId: input.organizationId,
        status: "DRAFT",
        deletedAt: null,
      },
      data: { status: "ACTIVE", launchedAt: campaign.launchedAt ?? now, pausedAt: null },
    });
    await writeAudit(tx, {
      organizationId: input.organizationId,
      sequenceId: input.campaignId,
      actorUserId: input.actorUserId,
      eventKind: "campaign.launched",
      payloadJson: { enrolled, existing, selected: selections.length },
      idempotencyKey: "campaign-launch:" + input.campaignId + ":" + input.idempotencyKey,
    });
    return {
      launched: true,
      alreadyActive: false,
      campaignId: input.campaignId,
      enrolled,
      existing,
      blockers: [],
    };
  }).catch((error) => {
    if (error instanceof CampaignCapacityChangedError) {
      return {
        launched: false,
        alreadyActive: false,
        campaignId: input.campaignId,
        enrolled: 0,
        existing: 0,
        blockers: [{
          code: "NO_HEALTHY_LIVE_SENDER",
          message: "Sender capacity was exhausted while assigning selected leads.",
          leadAssignmentId: error.leadAssignmentId,
        }],
      };
    }
    throw error;
  });
}

export async function pauseCampaign(
  db: RuntimeDb,
  input: LifecycleInput
): Promise<{ changed: boolean; status: "PAUSED" }> {
  assertLifecycleInput(input);
  return db.$transaction(async (tx) => {
    await lockCampaign(tx, input.organizationId, input.campaignId);
    const campaign = await tx.v2Sequence.findFirst({
      where: { id: input.campaignId, organizationId: input.organizationId, deletedAt: null },
      select: { status: true },
    });
    if (!campaign) throw new Error("Campaign not found.");
    if (campaign.status === "PAUSED") return { changed: false, status: "PAUSED" };
    if (campaign.status !== "ACTIVE") {
      throw new Error("Only an active campaign can pause.");
    }
    const changed = true;
    if (changed) {
      await tx.v2Sequence.updateMany({
        where: { id: input.campaignId, organizationId: input.organizationId, status: "ACTIVE", deletedAt: null },
        data: { status: "PAUSED", pausedAt: input.now ?? new Date() },
      });
      await tx.v2SequenceEnrollment.updateMany({
        where: {
          organizationId: input.organizationId,
          sequenceId: input.campaignId,
          status: "ACTIVE",
          deletedAt: null,
        },
        data: { status: "PAUSED" },
      });
      await writeAudit(tx, {
        organizationId: input.organizationId,
        sequenceId: input.campaignId,
        actorUserId: input.actorUserId,
        eventKind: "campaign.paused",
        reason: input.reason,
        idempotencyKey: "campaign-pause:" + input.campaignId + ":" + input.idempotencyKey,
      });
    }
    return { changed, status: "PAUSED" };
  });
}

export async function resumeCampaign(
  db: RuntimeDb,
  input: LifecycleInput & { organizationTimezone?: string | null }
): Promise<{ changed: boolean; status: "ACTIVE"; resumedEnrollments: number }> {
  assertLifecycleInput(input);
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockCampaign(tx, input.organizationId, input.campaignId);
    const campaign = await tx.v2Sequence.findFirst({
      where: { id: input.campaignId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!campaign) throw new Error("Campaign not found.");
    if (campaign.status === "ACTIVE") {
      return { changed: false, status: "ACTIVE", resumedEnrollments: 0 };
    }
    const schedule = campaign.scheduleJson as V2CampaignScheduleV1 | null;
    const errors = validateCampaignSchedule(schedule);
    if (campaign.status !== "PAUSED" || !schedule || errors.length > 0) {
      throw new Error("Only a paused campaign with a valid schedule can resume.");
    }
    const enrollments = await tx.v2SequenceEnrollment.findMany({
      where: {
        organizationId: input.organizationId,
        sequenceId: input.campaignId,
        status: "PAUSED",
        deletedAt: null,
      },
      select: { id: true, timezoneSnapshot: true },
    });
    for (const enrollment of enrollments) {
      const timezone = resolveCampaignTimezone({
        mode: campaign.timezoneMode,
        leadTimezone: enrollment.timezoneSnapshot,
        campaignTimezone: campaign.fallbackTimezone,
        organizationTimezone: input.organizationTimezone,
      });
      await tx.v2SequenceEnrollment.updateMany({
        where: { id: enrollment.id, organizationId: input.organizationId, status: "PAUSED" },
        data: { status: "ACTIVE", nextStepAt: nextCampaignWindow(now, schedule, timezone) },
      });
    }
    await tx.v2Sequence.updateMany({
      where: {
        id: input.campaignId,
        organizationId: input.organizationId,
        status: "PAUSED",
        deletedAt: null,
      },
      data: { status: "ACTIVE", pausedAt: null },
    });
    await writeAudit(tx, {
      organizationId: input.organizationId,
      sequenceId: input.campaignId,
      actorUserId: input.actorUserId,
      eventKind: "campaign.resumed",
      reason: input.reason,
      payloadJson: { resumedEnrollments: enrollments.length },
      idempotencyKey: "campaign-resume:" + input.campaignId + ":" + input.idempotencyKey,
    });
    return { changed: true, status: "ACTIVE", resumedEnrollments: enrollments.length };
  });
}

type LifecycleInput = {
  organizationId: string;
  campaignId: string;
  actorUserId: string;
  idempotencyKey: string;
  reason?: string | null;
  now?: Date;
};

async function prepareLead(
  tx: Tx,
  input: {
    organizationId: string;
    campaignId: string;
    timezoneMode: V2CampaignTimezoneMode;
    fallbackTimezone: string;
    organizationTimezone?: string | null;
    selection: CampaignLaunchSelection;
    variants: Array<{
      id: string;
      sequenceStepId: string;
      subjectTemplate: string | null;
      bodyTemplate: string | null;
      requiredVariablesJson: Prisma.JsonValue | null;
    }>;
    now: Date;
  }
): Promise<{ lead: PreparedLead | null; blockers: CampaignLaunchBlocker[] }> {
  const assignment = await tx.v2LeadAssignment.findFirst({
    where: {
      id: input.selection.leadAssignmentId,
      organizationId: input.organizationId,
      status: "ACTIVE",
      deletedAt: null,
      contact: { is: { status: "ACTIVE", deletedAt: null } },
      company: { status: "ACTIVE", deletedAt: null },
    },
    include: {
      contact: { include: { identifiers: true } },
      company: true,
      project: true,
      icpVersion: { include: { icpProfile: true } },
      latestHardRuleAssessment: true,
    },
  });
  if (!assignment?.contact) {
    return {
      lead: null,
      blockers: [{
        code: "INVALID_EMAIL",
        message: "Lead is missing, inactive, deleted, or has no active contact.",
        leadAssignmentId: input.selection.leadAssignmentId,
      }],
    };
  }
  const profile = await tx.v2LeadOutreachProfile.findFirst({
    where: {
      organizationId: input.organizationId,
      leadAssignmentId: assignment.id,
      deletedAt: null,
    },
  });
  const identifier = assignment.contact.identifiers
    .filter((item) => item.type === "EMAIL" && item.isValid)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
  const email = normalizeEmailIdentifier(profile?.primaryEmailNormalized ?? identifier?.normalizedValue);
  const suppressed = email
    ? await isSuppressed(tx, input.organizationId, email, input.now)
    : false;
  const qualification = normalizeQualification(assignment.latestHardRuleAssessment?.qualification);
  const decision = decideCampaignLeadEligibility({
    leadAssignmentId: assignment.id,
    qualification,
    fitScore: assignment.latestHardRuleAssessment?.fitScore ?? null,
    email,
    suppressed,
    overrideReason: input.selection.overrideReason,
  });
  if (!decision.eligible) {
    return {
      lead: null,
      blockers: [{
        code: decision.code,
        message: decision.reason,
        leadAssignmentId: assignment.id,
      }],
    };
  }

  const timezone = resolveCampaignTimezone({
    mode: input.timezoneMode,
    leadTimezone: profile?.timezone,
    campaignTimezone: input.fallbackTimezone,
    organizationTimezone: input.organizationTimezone,
  });
  const stored = asMergeData(profile?.mergeDataJson);
  const predefined = {
    email,
    first_name: assignment.contact.firstName,
    last_name: assignment.contact.lastName,
    name: assignment.contact.fullName,
    contact: assignment.contact.fullName,
    title: assignment.contact.title,
    company: assignment.company.name,
    website: assignment.company.websiteUrl,
    domain: assignment.company.canonicalDomain,
    country: assignment.company.country,
    project: assignment.project.name,
    icp: assignment.icpVersion.icpProfile.name,
    ...stored.predefined,
  };
  const mergeData: V2LeadOutreachMergeDataV1 = {
    schemaVersion: "v2.outreach-profile.v1",
    predefined,
    custom: stored.custom,
  };
  const context = { ...stored.custom, ...predefined, custom: stored.custom };
  const blockers: CampaignLaunchBlocker[] = [];
  for (const variant of input.variants) {
    const required = toStringArray(variant.requiredVariablesJson);
    const unresolved = findUnresolvedRequiredVariables(context, required);
    if (unresolved.length > 0) {
      blockers.push({
        code: "REQUIRED_VARIABLE_MISSING",
        message: "Missing required variables: " + unresolved.join(", "),
        leadAssignmentId: assignment.id,
        stepId: variant.sequenceStepId,
      });
      continue;
    }
    try {
      await renderCampaignTemplate({
        template: variant.subjectTemplate ?? "",
        context,
        requiredVariables: required,
        seed: assignment.id + ":" + variant.id + ":subject",
      });
      await renderCampaignTemplate({
        template: variant.bodyTemplate ?? "",
        context,
        requiredVariables: required,
        seed: assignment.id + ":" + variant.id + ":body",
      });
    } catch (error) {
      blockers.push({
        code: "INVALID_TEMPLATE",
        message: error instanceof Error ? error.message : "Template validation failed.",
        leadAssignmentId: assignment.id,
        stepId: variant.sequenceStepId,
      });
    }
  }
  if (blockers.length > 0 || !email) return { lead: null, blockers };
  const snapshot: V2EnrollmentRenderSnapshotV1 = {
    schemaVersion: "v2.enrollment-snapshot.v1",
    recipientEmail: email,
    timezone,
    mergeData,
  };
  return {
    blockers: [],
    lead: {
      leadAssignmentId: assignment.id,
      contactId: assignment.contact.id,
      profileId: profile?.id ?? null,
      qualification,
      fitScore: assignment.latestHardRuleAssessment?.fitScore ?? null,
      email,
      timezone,
      snapshot,
      fingerprint:
        profile?.sourceFingerprint ??
        createHash("sha256").update(stableJson(snapshot)).digest("hex"),
      overrideReason:
        qualification === "QUALIFIED" ? null : input.selection.overrideReason!.trim(),
    },
  };
}

async function loadSenders(
  tx: Tx,
  organizationId: string,
  campaignId: string,
  now: Date
): Promise<RuntimeSender[]> {
  const pool = await tx.v2SequenceSenderAccount.findMany({
    where: { organizationId, sequenceId: campaignId, enabled: true },
    orderBy: { senderAccountId: "asc" },
  });
  const senders = await tx.v2SenderAccount.findMany({
    where: {
      organizationId,
      id: { in: pool.map((item) => item.senderAccountId) },
      deletedAt: null,
    },
  });
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daily = await tx.v2SenderDailySend.findMany({
    where: { organizationId, senderAccountId: { in: senders.map((item) => item.id) }, sendDate: day },
  });
  const domains = await tx.v2TrackingDomain.findMany({
    where: {
      organizationId,
      id: { in: senders.flatMap((item) => (item.trackingDomainId ? [item.trackingDomainId] : [])) },
      deletedAt: null,
    },
  });
  return senders.map((sender) => ({
    id: sender.id,
    kind: sender.kind,
    status: sender.status,
    dailyCapCurrent: sender.dailyCapCurrent,
    dailyCapTarget: sender.dailyCapTarget,
    warmupStage: sender.warmupStage,
    bounceRate: sender.bounceRate,
    complaintRate: sender.complaintRate,
    sentToday: daily.find((item) => item.senderAccountId === sender.id)?.count ?? 0,
    lastSendAt: sender.lastSendAt,
    displayName: sender.displayName,
    fromAddress: sender.fromAddress,
    liveSendEnabled: sender.liveSendEnabled,
    trackingStatus:
      domains.find((domain) => domain.id === sender.trackingDomainId)?.status ?? null,
  }));
}

async function isSuppressed(
  tx: Tx,
  organizationId: string,
  email: string,
  now: Date
): Promise<boolean> {
  const domain = extractDomainIdentifier(email);
  const match = await tx.v2SuppressionEntry.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [{
        OR: [
          { identifierType: "EMAIL", identifierValueNormalized: email },
          ...(domain
            ? [{ identifierType: "DOMAIN" as const, identifierValueNormalized: domain }]
            : []),
        ],
      }],
    },
    select: { id: true },
  });
  return Boolean(match);
}

async function lockCampaign(tx: Tx, organizationId: string, campaignId: string): Promise<void> {
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    organizationId + ":" + campaignId
  );
}

async function writeAudit(
  tx: Tx,
  input: {
    organizationId: string;
    sequenceId: string;
    leadAssignmentId?: string;
    actorUserId: string;
    eventKind: string;
    reason?: string | null;
    payloadJson?: unknown;
    idempotencyKey: string;
  }
): Promise<void> {
  const existing = await tx.v2OutreachAuditEvent.findFirst({
    where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return;
  await tx.v2OutreachAuditEvent.create({
    data: {
      id: generateId("oaud"),
      organizationId: input.organizationId,
      sequenceId: input.sequenceId,
      leadAssignmentId: input.leadAssignmentId,
      actorUserId: input.actorUserId,
      eventKind: input.eventKind,
      reason: input.reason,
      payloadJson:
        input.payloadJson == null
          ? undefined
          : (input.payloadJson as Prisma.InputJsonValue),
      idempotencyKey: input.idempotencyKey,
    },
  });
}

function asMergeData(value: unknown): V2LeadOutreachMergeDataV1 {
  if (!isRecord(value)) {
    return { schemaVersion: "v2.outreach-profile.v1", predefined: {}, custom: {} };
  }
  return {
    schemaVersion: "v2.outreach-profile.v1",
    predefined: isRecord(value.predefined)
      ? (value.predefined as Record<string, string | null>)
      : {},
    custom: isRecord(value.custom)
      ? (value.custom as Record<string, string | number | boolean | null>)
      : {},
  };
}

function normalizeQualification(
  value: string | null | undefined
): PreparedLead["qualification"] {
  if (value === "QUALIFIED" || value === "NEEDS_REVIEW" || value === "UNQUALIFIED") {
    return value;
  }
  return value ? "NEEDS_REVIEW" : "NOT_SCORED";
}
function assertLifecycleInput(input: {
  organizationId: string;
  campaignId: string;
  actorUserId: string;
  idempotencyKey: string;
}): void {
  if (
    !input.organizationId.trim() ||
    !input.campaignId.trim() ||
    !input.actorUserId.trim() ||
    !input.idempotencyKey.trim()
  ) {
    throw new Error("Campaign lifecycle requires tenant, campaign, actor, and idempotency key.");
  }
}
function uniqueSelections(
  selections: readonly CampaignLaunchSelection[]
): CampaignLaunchSelection[] {
  const byLead = new Map<string, CampaignLaunchSelection>();
  for (const selection of selections) {
    if (selection.leadAssignmentId && !byLead.has(selection.leadAssignmentId)) {
      byLead.set(selection.leadAssignmentId, selection);
    }
  }
  return [...byLead.values()];
}

function blocked(
  campaignId: string,
  code: CampaignLaunchBlocker["code"],
  message: string
): CampaignLaunchResult {
  return {
    launched: false,
    alreadyActive: false,
    campaignId,
    enrolled: 0,
    existing: 0,
    blockers: [{ code, message }],
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (isRecord(value)) {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function generateId(prefix: string): string {
  return prefix + "_" + randomBytes(12).toString("hex");
}

class CampaignCapacityChangedError extends Error {
  constructor(readonly leadAssignmentId: string) {
    super("Campaign sender capacity changed.");
  }
}