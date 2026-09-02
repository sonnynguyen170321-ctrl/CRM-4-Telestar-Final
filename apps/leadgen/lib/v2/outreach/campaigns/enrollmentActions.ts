import "server-only";

import { prisma } from "@/lib/server/prisma";
import {
  nextCampaignWindow,
  resolveCampaignTimezone,
  validateCampaignSchedule,
} from "./schedule";
import type { V2CampaignScheduleV1, V2CampaignTimezoneMode } from "./types";

// Per-lead (per-enrollment) campaign actions for the campaign leads manager. Mirrors the
// campaign-wide pause/resume/remove in campaignRuntime.ts but scoped to chosen
// V2SequenceEnrollment rows. Tenant-scoped (Inv 5); soft-delete on remove (Inv 8); each
// writes a V2OutreachAuditEvent. Idempotent via status guards in the WHERE clause.

export type EnrollmentActionInput = {
  organizationId: string;
  campaignId: string;
  enrollmentIds: string[];
  actorUserId: string;
  reason?: string | null;
};

export type EnrollmentActionResult = { changed: number };

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(0, 1000);
}

async function writeEnrollmentAudit(
  organizationId: string,
  campaignId: string,
  leadAssignmentId: string,
  actorUserId: string,
  eventKind: string,
  reason: string | null | undefined
): Promise<void> {
  const idempotencyKey = `${eventKind}:${leadAssignmentId}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  try {
    await prisma.v2OutreachAuditEvent.create({
      data: {
        organizationId,
        sequenceId: campaignId,
        leadAssignmentId,
        actorUserId,
        eventKind,
        reason: reason ?? null,
        idempotencyKey,
      },
    });
  } catch {
    // audit is best-effort; never block the action on a duplicate key
  }
}

export async function pauseEnrollments(input: EnrollmentActionInput): Promise<EnrollmentActionResult> {
  const ids = uniqueIds(input.enrollmentIds);
  if (ids.length === 0) return { changed: 0 };

  const targets = await prisma.v2SequenceEnrollment.findMany({
    where: {
      id: { in: ids },
      organizationId: input.organizationId,
      sequenceId: input.campaignId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true, leadAssignmentId: true },
  });
  if (targets.length === 0) return { changed: 0 };

  await prisma.v2SequenceEnrollment.updateMany({
    where: { id: { in: targets.map((t) => t.id) }, organizationId: input.organizationId, status: "ACTIVE" },
    data: { status: "PAUSED" },
  });
  for (const t of targets) {
    await writeEnrollmentAudit(input.organizationId, input.campaignId, t.leadAssignmentId, input.actorUserId, "enrollment.paused", input.reason);
  }
  return { changed: targets.length };
}

export async function resumeEnrollments(input: EnrollmentActionInput): Promise<EnrollmentActionResult> {
  const ids = uniqueIds(input.enrollmentIds);
  if (ids.length === 0) return { changed: 0 };

  const campaign = await prisma.v2Sequence.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId, deletedAt: null },
    select: { status: true, scheduleJson: true, timezoneMode: true, fallbackTimezone: true },
  });
  const schedule = (campaign?.scheduleJson ?? null) as V2CampaignScheduleV1 | null;
  // A paused lead can only resume into an ACTIVE campaign with a valid schedule.
  if (!campaign || campaign.status !== "ACTIVE" || !schedule || validateCampaignSchedule(schedule).length > 0) {
    return { changed: 0 };
  }

  const targets = await prisma.v2SequenceEnrollment.findMany({
    where: {
      id: { in: ids },
      organizationId: input.organizationId,
      sequenceId: input.campaignId,
      status: "PAUSED",
      deletedAt: null,
    },
    select: { id: true, leadAssignmentId: true, timezoneSnapshot: true },
  });

  const now = new Date();
  let changed = 0;
  for (const t of targets) {
    const timezone = resolveCampaignTimezone({
      mode: campaign.timezoneMode as V2CampaignTimezoneMode,
      leadTimezone: t.timezoneSnapshot,
      campaignTimezone: campaign.fallbackTimezone,
    });
    const res = await prisma.v2SequenceEnrollment.updateMany({
      where: { id: t.id, organizationId: input.organizationId, status: "PAUSED" },
      data: { status: "ACTIVE", nextStepAt: nextCampaignWindow(now, schedule, timezone) },
    });
    if (res.count > 0) {
      changed += 1;
      await writeEnrollmentAudit(input.organizationId, input.campaignId, t.leadAssignmentId, input.actorUserId, "enrollment.resumed", input.reason);
    }
  }
  return { changed };
}

export async function removeEnrollments(input: EnrollmentActionInput): Promise<EnrollmentActionResult> {
  const ids = uniqueIds(input.enrollmentIds);
  if (ids.length === 0) return { changed: 0 };

  const targets = await prisma.v2SequenceEnrollment.findMany({
    where: {
      id: { in: ids },
      organizationId: input.organizationId,
      sequenceId: input.campaignId,
      deletedAt: null,
    },
    select: { id: true, leadAssignmentId: true },
  });
  if (targets.length === 0) return { changed: 0 };

  await prisma.v2SequenceEnrollment.updateMany({
    where: { id: { in: targets.map((t) => t.id) }, organizationId: input.organizationId, deletedAt: null },
    data: { status: "HALTED", haltReason: input.reason ?? "Removed from campaign", deletedAt: new Date() },
  });
  for (const t of targets) {
    await writeEnrollmentAudit(input.organizationId, input.campaignId, t.leadAssignmentId, input.actorUserId, "enrollment.removed", input.reason);
  }
  return { changed: targets.length };
}
