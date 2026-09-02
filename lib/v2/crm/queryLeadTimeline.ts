import "server-only";

import { prisma } from "@/lib/server/prisma";

export type LeadTimelineEventSource = "activity" | "outreach" | "audit" | "review";

export type LeadTimelineEvent = {
  source: LeadTimelineEventSource;
  sourceId: string;
  leadAssignmentId: string;
  occurredAt: string;
  eventKind: string;
  channel: string;
  actorUserId: string | null;
  title: string;
  metadata: Record<string, unknown>;
};

export type QueryLeadTimelineInput = {
  organizationId: string;
  leadAssignmentId: string;
  limit?: number;
};

type ActivityRow = {
  id: string;
  leadAssignmentId: string;
  occurredAt: Date;
  channel: string;
  activityType: string;
  outcome: string;
  actorUserId: string | null;
  note: string | null;
  timestampQuality: string;
  metadataJson: unknown;
};

type AuditRow = {
  id: string;
  leadAssignmentId: string;
  occurredAt: Date;
  eventType: string;
  actorUserId: string | null;
  metadataJson: unknown;
};

type ReviewRow = {
  id: string;
  leadAssignmentId: string;
  createdAt: Date;
  resolvedAt: Date | null;
  reasonCode: string;
  status: string;
  createdByUserId: string | null;
  resolvedByUserId: string | null;
  assignedToUserId: string | null;
  metadataJson: unknown;
};

export async function queryLeadTimeline(
  input: QueryLeadTimelineInput
): Promise<LeadTimelineEvent[]> {
  if (!input.organizationId) {
    throw new Error("queryLeadTimeline: organizationId is required (tenant isolation).");
  }
  if (!input.leadAssignmentId) {
    throw new Error("queryLeadTimeline: leadAssignmentId is required.");
  }

  const { organizationId, leadAssignmentId, limit = 100 } = input;

  const [activityRows, auditRows, reviewRows] = await Promise.all([
    prisma.$queryRaw<ActivityRow[]>`
      SELECT
        id,
        "leadAssignmentId",
        "occurredAt",
        channel,
        "activityType",
        outcome,
        "actorUserId",
        note,
        "timestampQuality",
        "metadataJson"
      FROM "V2ActivityRecord"
      WHERE "organizationId" = ${organizationId}
        AND "leadAssignmentId" = ${leadAssignmentId}
        AND "deletedAt" IS NULL
      ORDER BY "occurredAt" ASC
    `,
    prisma.$queryRaw<AuditRow[]>`
      SELECT
        id,
        "entityId" AS "leadAssignmentId",
        "createdAt" AS "occurredAt",
        "eventType",
        "actorUserId",
        "metadataJson"
      FROM "V2AuditEvent"
      WHERE "organizationId" = ${organizationId}
        AND "entityType" = 'LeadAssignment'
        AND "entityId" = ${leadAssignmentId}
      ORDER BY "createdAt" ASC
    `,
    prisma.$queryRaw<ReviewRow[]>`
      SELECT
        id,
        "leadAssignmentId",
        "createdAt",
        "resolvedAt",
        "reasonCode",
        status,
        "createdByUserId",
        "resolvedByUserId",
        "assignedToUserId",
        "metadataJson"
      FROM "V2ManagerReviewItem"
      WHERE "organizationId" = ${organizationId}
        AND "leadAssignmentId" = ${leadAssignmentId}
        AND "deletedAt" IS NULL
    `,
  ]);

  const events: LeadTimelineEvent[] = [];

  for (const row of activityRows) {
    events.push({
      source: "activity",
      sourceId: row.id,
      leadAssignmentId: row.leadAssignmentId,
      occurredAt: row.occurredAt.toISOString(),
      eventKind: `activity.${row.activityType}`,
      channel: row.channel,
      actorUserId: row.actorUserId ?? null,
      title: buildActivityTitle(row.channel, row.activityType, row.outcome),
      metadata: {
        outcome: row.outcome,
        note: row.note ?? null,
        timestampQuality: row.timestampQuality,
        ...flattenJson(row.metadataJson),
      },
    });
  }

  for (const row of auditRows) {
    events.push({
      source: "audit",
      sourceId: row.id,
      leadAssignmentId: row.leadAssignmentId,
      occurredAt: row.occurredAt.toISOString(),
      eventKind: `audit.${row.eventType}`,
      channel: "system",
      actorUserId: row.actorUserId ?? null,
      title: buildAuditTitle(row.eventType),
      metadata: {
        eventType: row.eventType,
        ...flattenJson(row.metadataJson),
      },
    });
  }

  for (const row of reviewRows) {
    events.push({
      source: "review",
      sourceId: row.id,
      leadAssignmentId: row.leadAssignmentId,
      occurredAt: row.createdAt.toISOString(),
      eventKind: "review.opened",
      channel: "review",
      actorUserId: row.createdByUserId ?? null,
      title: `Review opened: ${formatReasonCode(row.reasonCode)}`,
      metadata: {
        reasonCode: row.reasonCode,
        status: row.status,
        assignedToUserId: row.assignedToUserId ?? null,
      },
    });

    if (row.resolvedAt !== null) {
      events.push({
        source: "review",
        sourceId: row.id,
        leadAssignmentId: row.leadAssignmentId,
        occurredAt: row.resolvedAt.toISOString(),
        eventKind: "review.resolved",
        channel: "review",
        actorUserId: row.resolvedByUserId ?? null,
        title: `Review resolved: ${formatReasonCode(row.reasonCode)}`,
        metadata: {
          reasonCode: row.reasonCode,
        },
      });
    }
  }

  // Sort by occurredAt ASC; stable tiebreak: source order then sourceId
  const SOURCE_ORDER: Record<LeadTimelineEventSource, number> = {
    audit: 0,
    review: 1,
    activity: 2,
    outreach: 3,
  };
  events.sort((a, b) => {
    const timeDiff = a.occurredAt.localeCompare(b.occurredAt);
    if (timeDiff !== 0) return timeDiff;
    const sourceDiff =
      (SOURCE_ORDER[a.source as LeadTimelineEventSource] ?? 99) -
      (SOURCE_ORDER[b.source as LeadTimelineEventSource] ?? 99);
    if (sourceDiff !== 0) return sourceDiff;
    return a.sourceId.localeCompare(b.sourceId);
  });

  return limit > 0 ? events.slice(0, limit) : events;
}

export function buildActivityTitle(
  channel: string,
  activityType: string,
  outcome: string
): string {
  const ch = capitalize(channel.replace(/_/g, " "));
  const type = capitalize(activityType.replace(/_/g, " "));
  const out = capitalize(outcome.replace(/_/g, " "));
  return `${ch} — ${type}: ${out}`;
}

export function buildAuditTitle(eventType: string): string {
  return capitalize(eventType.replace(/_/g, " "));
}

export function formatReasonCode(reasonCode: string): string {
  return reasonCode
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function flattenJson(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
