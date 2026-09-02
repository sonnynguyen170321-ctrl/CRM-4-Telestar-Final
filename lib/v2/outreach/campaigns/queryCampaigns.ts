import "server-only";

import { prisma } from "@/lib/server/prisma";
import { queryTrackingAnalytics, type TrackingAnalytics } from "@/lib/v2/outreach/reporting/queryTrackingAnalytics";

export type CampaignReadinessCode =
  | "NO_EMAIL_STEP"
  | "NO_SENDER_POOL"
  | "NO_LIVE_SENDER"
  | "NO_ENROLLED_LEADS"
  | "SCHEDULE_MISSING"
  | "TRACKING_DOMAIN_UNVERIFIED";

export type CampaignSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  timezoneMode: string;
  fallbackTimezone: string;
  scheduleJson: unknown;
  trackingEnabled: boolean;
  stopOnReply?: boolean;
  stopOnBounce?: boolean;
  stopOnMeeting?: boolean;
  maxTouches?: number | null;
  launchedAt: string | null;
  pausedAt: string | null;
  updatedAt: string;
  stepCount: number;
  variantCount: number;
  senderCount: number;
  liveSenderCount: number;
  enrolledCount: number;
  sentCount: number;
  repliedCount: number;
  bouncedCount: number;
  failedCount: number;
  verifiedTrackingSenderCount: number;
  readiness: CampaignReadinessCode[];
};

export type CampaignDetail = CampaignSummary & {
  steps: CampaignStep[];
  senders: CampaignSender[];
  enrollmentStatuses: Array<{ status: string; count: number }>;
  profileBreakdown: CampaignProfileBreakdown[];
  auditEvents: CampaignAuditEvent[];
  tracking: TrackingAnalytics;
};

export type CampaignStep = {
  id: string;
  ordinal: number;
  kind: string;
  delayMinutes: number;
  variants: CampaignVariant[];
};

export type CampaignVariant = {
  id: string;
  key: string;
  name: string | null;
  weight: number;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  requiredVariables: string[];
  assignedCount: number;
  sentCount: number;
  repliedCount: number;
  bouncedCount: number;
  failedCount: number;
};

export type CampaignSender = {
  poolId: string;
  id: string;
  displayName: string;
  fromAddress: string;
  kind: string;
  status: string;
  liveSendEnabled: boolean;
  poolEnabled: boolean;
  poolWeight: number;
  dailyCapCurrent: number;
  dailyCapTarget: number;
  bounceRate: number;
  complaintRate: number;
  trackingHostname: string | null;
  trackingStatus: string | null;
};


export type CampaignProfileBreakdown = {
  timezone: string;
  count: number;
  profileCount: number;
  emailSnapshotCount: number;
  mergeSnapshotCount: number;
};

export type CampaignAuditEvent = {
  id: string;
  eventKind: string;
  reason: string | null;
  occurredAt: string;
  actorUserId: string | null;
  senderAccountId: string | null;
  leadAssignmentId: string | null;
};
type CampaignRow = Omit<
  CampaignSummary,
  "launchedAt" | "pausedAt" | "updatedAt" | "readiness"
> & {
  launchedAt: Date | string | null;
  pausedAt: Date | string | null;
  updatedAt: Date | string;
};

const CAMPAIGN_SELECT = [
  'SELECT sequence."id", sequence."name", sequence."description",',
  'sequence."status"::text AS "status", sequence."timezoneMode"::text AS "timezoneMode",',
  'sequence."fallbackTimezone", sequence."scheduleJson", sequence."trackingEnabled",',
  'sequence."stopOnReply", sequence."stopOnBounce", sequence."stopOnMeeting", sequence."maxTouches",',
  'sequence."launchedAt", sequence."pausedAt", sequence."updatedAt",',
  '(SELECT COUNT(*)::int FROM "V2SequenceStep" step WHERE step."organizationId" = sequence."organizationId" AND step."sequenceId" = sequence."id") AS "stepCount",',
  '(SELECT COUNT(*)::int FROM "V2SequenceStepVariant" variant INNER JOIN "V2SequenceStep" step ON step."id" = variant."sequenceStepId" AND step."organizationId" = variant."organizationId" WHERE variant."organizationId" = sequence."organizationId" AND step."sequenceId" = sequence."id" AND variant."enabled" = true) AS "variantCount",',
  '(SELECT COUNT(*)::int FROM "V2SequenceSenderAccount" pool WHERE pool."organizationId" = sequence."organizationId" AND pool."sequenceId" = sequence."id" AND pool."enabled" = true) AS "senderCount",',
  '(SELECT COUNT(*)::int FROM "V2SequenceSenderAccount" pool INNER JOIN "V2SenderAccount" sender ON sender."id" = pool."senderAccountId" AND sender."organizationId" = pool."organizationId" AND sender."deletedAt" IS NULL WHERE pool."organizationId" = sequence."organizationId" AND pool."sequenceId" = sequence."id" AND pool."enabled" = true AND sender."status" = \'ACTIVE\' AND sender."liveSendEnabled" = true) AS "liveSenderCount",',
  '(SELECT COUNT(*)::int FROM "V2SequenceEnrollment" enrollment WHERE enrollment."organizationId" = sequence."organizationId" AND enrollment."sequenceId" = sequence."id" AND enrollment."deletedAt" IS NULL) AS "enrolledCount",',
  '(SELECT COUNT(*)::int FROM "V2OutreachMessage" message INNER JOIN "V2SequenceEnrollment" enrollment ON enrollment."id" = message."enrollmentId" AND enrollment."organizationId" = message."organizationId" WHERE message."organizationId" = sequence."organizationId" AND enrollment."sequenceId" = sequence."id" AND message."deletedAt" IS NULL AND message."status" IN (\'SENT\', \'REPLIED\', \'BOUNCED\')) AS "sentCount",',
  '(SELECT COUNT(*)::int FROM "V2OutreachMessage" message INNER JOIN "V2SequenceEnrollment" enrollment ON enrollment."id" = message."enrollmentId" AND enrollment."organizationId" = message."organizationId" WHERE message."organizationId" = sequence."organizationId" AND enrollment."sequenceId" = sequence."id" AND message."deletedAt" IS NULL AND message."status" = \'REPLIED\') AS "repliedCount",',
  '(SELECT COUNT(*)::int FROM "V2OutreachMessage" message INNER JOIN "V2SequenceEnrollment" enrollment ON enrollment."id" = message."enrollmentId" AND enrollment."organizationId" = message."organizationId" WHERE message."organizationId" = sequence."organizationId" AND enrollment."sequenceId" = sequence."id" AND message."deletedAt" IS NULL AND message."status" = \'BOUNCED\') AS "bouncedCount",',
  '(SELECT COUNT(*)::int FROM "V2OutreachMessage" message INNER JOIN "V2SequenceEnrollment" enrollment ON enrollment."id" = message."enrollmentId" AND enrollment."organizationId" = message."organizationId" WHERE message."organizationId" = sequence."organizationId" AND enrollment."sequenceId" = sequence."id" AND message."deletedAt" IS NULL AND message."status" = \'FAILED\') AS "failedCount",',
  '(SELECT COUNT(*)::int FROM "V2SequenceSenderAccount" pool INNER JOIN "V2SenderAccount" sender ON sender."id" = pool."senderAccountId" AND sender."organizationId" = pool."organizationId" AND sender."deletedAt" IS NULL INNER JOIN "V2TrackingDomain" domain ON domain."id" = sender."trackingDomainId" AND domain."organizationId" = sender."organizationId" AND domain."deletedAt" IS NULL WHERE pool."organizationId" = sequence."organizationId" AND pool."sequenceId" = sequence."id" AND pool."enabled" = true AND domain."status" = \'VERIFIED\') AS "verifiedTrackingSenderCount"',
  'FROM "V2Sequence" sequence',
  'WHERE sequence."organizationId" = $1 AND sequence."deletedAt" IS NULL',
  'AND ($2::text IS NULL OR sequence."id" = $2)',
  'ORDER BY CASE sequence."status" WHEN \'ACTIVE\' THEN 0 WHEN \'DRAFT\' THEN 1 WHEN \'PAUSED\' THEN 2 ELSE 3 END, sequence."updatedAt" DESC',
  'LIMIT 100',
].join("\n");

export async function queryCampaigns(organizationId: string) {
  const rows = await loadCampaignRows(organizationId, null);
  return rows.map(normalizeCampaign);
}

export async function queryCampaignDetail(
  organizationId: string,
  campaignId: string
): Promise<CampaignDetail | null> {
  const [campaignRow] = await loadCampaignRows(organizationId, campaignId);
  if (!campaignRow) return null;

  const [stepRows, senderRows, enrollmentStatuses, profileBreakdown, auditEvents, tracking] = await Promise.all([
    loadSteps(organizationId, campaignId),
    loadSenders(organizationId, campaignId),
    loadEnrollmentStatuses(organizationId, campaignId),
    loadProfileBreakdown(organizationId, campaignId),
    loadAuditEvents(organizationId, campaignId),
    loadCampaignTracking(organizationId, campaignId),
  ]);

  return {
    ...normalizeCampaign(campaignRow),
    steps: groupSteps(stepRows),
    senders: senderRows.map(normalizeSender),
    enrollmentStatuses: enrollmentStatuses.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
    profileBreakdown,
    auditEvents,
    tracking,
  };
}

async function loadCampaignRows(organizationId: string, campaignId: string | null) {
  return prisma.$queryRawUnsafe<CampaignRow[]>(
    CAMPAIGN_SELECT,
    organizationId,
    campaignId
  );
}

function normalizeCampaign(row: CampaignRow): CampaignSummary {
  const campaign = {
    ...row,
    trackingEnabled: Boolean(row.trackingEnabled),
    launchedAt: toIso(row.launchedAt),
    pausedAt: toIso(row.pausedAt),
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
    stepCount: Number(row.stepCount),
    variantCount: Number(row.variantCount),
    senderCount: Number(row.senderCount),
    liveSenderCount: Number(row.liveSenderCount),
    enrolledCount: Number(row.enrolledCount),
    sentCount: Number(row.sentCount),
    repliedCount: Number(row.repliedCount),
    bouncedCount: Number(row.bouncedCount),
    failedCount: Number(row.failedCount),
    verifiedTrackingSenderCount: Number(row.verifiedTrackingSenderCount),
    stopOnReply: Boolean(row.stopOnReply),
    stopOnBounce: Boolean(row.stopOnBounce),
    stopOnMeeting: Boolean(row.stopOnMeeting),
    maxTouches: row.maxTouches == null ? null : Number(row.maxTouches),
  };
  return { ...campaign, readiness: buildReadiness(campaign) };
}

function buildReadiness(campaign: Omit<CampaignSummary, "readiness">) {
  const blockers: CampaignReadinessCode[] = [];
  if (campaign.stepCount === 0) blockers.push("NO_EMAIL_STEP");
  if (campaign.senderCount === 0) blockers.push("NO_SENDER_POOL");
  if (campaign.liveSenderCount === 0) blockers.push("NO_LIVE_SENDER");
  if (campaign.enrolledCount === 0) blockers.push("NO_ENROLLED_LEADS");
  if (!campaign.scheduleJson) blockers.push("SCHEDULE_MISSING");
  if (campaign.trackingEnabled && campaign.verifiedTrackingSenderCount === 0) {
    blockers.push("TRACKING_DOMAIN_UNVERIFIED");
  }
  return blockers;
}

function toIso(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
async function loadSteps(organizationId: string, campaignId: string) {
  const sql = [
    'SELECT step."id", step."ordinal", step."kind"::text AS "kind", step."delayMinutes",',
    'variant."id" AS "variantId", variant."variantKey", variant."name" AS "variantName",',
    'variant."weight", variant."subjectTemplate", variant."bodyTemplate", variant."requiredVariablesJson",',
    'COALESCE(stats."assignedCount", 0)::int AS "variantAssignedCount",',
    'COALESCE(stats."sentCount", 0)::int AS "variantSentCount",',
    'COALESCE(stats."repliedCount", 0)::int AS "variantRepliedCount",',
    'COALESCE(stats."bouncedCount", 0)::int AS "variantBouncedCount",',
    'COALESCE(stats."failedCount", 0)::int AS "variantFailedCount"',
    'FROM "V2SequenceStep" step',
    'LEFT JOIN "V2SequenceStepVariant" variant ON variant."sequenceStepId" = step."id"',
    'AND variant."organizationId" = step."organizationId" AND variant."enabled" = true',
    'LEFT JOIN LATERAL (',
    '  SELECT COUNT(*)::int AS "assignedCount",',
    `         COUNT(*) FILTER (WHERE message."status" IN ('SENT','REPLIED','BOUNCED'))::int AS "sentCount",`,
    `         COUNT(*) FILTER (WHERE message."status" = 'REPLIED')::int AS "repliedCount",`,
    `         COUNT(*) FILTER (WHERE message."status" = 'BOUNCED')::int AS "bouncedCount",`,
    `         COUNT(*) FILTER (WHERE message."status" = 'FAILED')::int AS "failedCount"`,
    '  FROM "V2OutreachMessage" message',
    '  WHERE message."organizationId" = step."organizationId"',
    '    AND message."sequenceStepVariantId" = variant."id"',
    '    AND message."deletedAt" IS NULL',
    ') stats ON variant."id" IS NOT NULL',
    'WHERE step."organizationId" = $1 AND step."sequenceId" = $2',
    'ORDER BY step."ordinal" ASC, variant."variantKey" ASC',
  ].join("\n");
  return prisma.$queryRawUnsafe<StepRow[]>(sql, organizationId, campaignId);
}
async function loadSenders(organizationId: string, campaignId: string) {
  const sql = [
    'SELECT pool."id" AS "poolId", pool."enabled" AS "poolEnabled", pool."weight" AS "poolWeight",',
    'sender."id", sender."displayName", sender."fromAddress",',
    'sender."kind"::text AS "kind", sender."status"::text AS "status",',
    'sender."liveSendEnabled", sender."dailyCapCurrent", sender."dailyCapTarget",',
    'sender."bounceRate", sender."complaintRate",',
    'domain."hostname" AS "trackingHostname", domain."status"::text AS "trackingStatus"',
    'FROM "V2SequenceSenderAccount" pool',
    'INNER JOIN "V2SenderAccount" sender ON sender."id" = pool."senderAccountId"',
    'AND sender."organizationId" = pool."organizationId" AND sender."deletedAt" IS NULL',
    'LEFT JOIN "V2TrackingDomain" domain ON domain."id" = sender."trackingDomainId"',
    'AND domain."organizationId" = sender."organizationId" AND domain."deletedAt" IS NULL',
    'WHERE pool."organizationId" = $1 AND pool."sequenceId" = $2',
    'ORDER BY pool."enabled" DESC, sender."liveSendEnabled" DESC, pool."weight" DESC, sender."displayName" ASC',
  ].join("\n");
  return prisma.$queryRawUnsafe<SenderRow[]>(sql, organizationId, campaignId);
}
async function loadEnrollmentStatuses(
  organizationId: string,
  campaignId: string
) {
  const sql = [
    'SELECT enrollment."status"::text AS "status", COUNT(*)::int AS "count"',
    'FROM "V2SequenceEnrollment" enrollment',
    'WHERE enrollment."organizationId" = $1 AND enrollment."sequenceId" = $2',
    'AND enrollment."deletedAt" IS NULL',
    'GROUP BY enrollment."status" ORDER BY enrollment."status"',
  ].join("\n");
  return prisma.$queryRawUnsafe<Array<{ status: string; count: number }>>(
    sql,
    organizationId,
    campaignId
  );
}
async function loadProfileBreakdown(
  organizationId: string,
  campaignId: string
): Promise<CampaignProfileBreakdown[]> {
  const sql = [
    `SELECT COALESCE(enrollment."timezoneSnapshot", profile."timezone", 'UTC') AS "timezone",`,
    'COUNT(*)::int AS "count",',
    'COUNT(profile."id")::int AS "profileCount",',
    'COUNT(enrollment."recipientEmailSnapshot")::int AS "emailSnapshotCount",',
    'COUNT(enrollment."renderContextSnapshotJson")::int AS "mergeSnapshotCount"',
    'FROM "V2SequenceEnrollment" enrollment',
    'LEFT JOIN "V2LeadOutreachProfile" profile ON profile."id" = enrollment."outreachProfileId"',
    'AND profile."organizationId" = enrollment."organizationId" AND profile."deletedAt" IS NULL',
    'WHERE enrollment."organizationId" = $1 AND enrollment."sequenceId" = $2',
    'AND enrollment."deletedAt" IS NULL',
    `GROUP BY COALESCE(enrollment."timezoneSnapshot", profile."timezone", 'UTC')`,
    'ORDER BY "count" DESC, "timezone" ASC',
  ].join("\n");
  const rows = await prisma.$queryRawUnsafe<CampaignProfileBreakdown[]>(sql, organizationId, campaignId);
  return rows.map((row) => ({
    timezone: row.timezone,
    count: Number(row.count),
    profileCount: Number(row.profileCount),
    emailSnapshotCount: Number(row.emailSnapshotCount),
    mergeSnapshotCount: Number(row.mergeSnapshotCount),
  }));
}

async function loadAuditEvents(
  organizationId: string,
  campaignId: string
): Promise<CampaignAuditEvent[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      eventKind: string;
      reason: string | null;
      occurredAt: Date | string;
      actorUserId: string | null;
      senderAccountId: string | null;
      leadAssignmentId: string | null;
    }>
  >(
    `SELECT "id", "eventKind", "reason", "occurredAt", "actorUserId", "senderAccountId", "leadAssignmentId"
     FROM "V2OutreachAuditEvent"
     WHERE "organizationId" = $1 AND "sequenceId" = $2
     ORDER BY "occurredAt" DESC
     LIMIT 50`,
    organizationId,
    campaignId
  );
  return rows.map((row) => ({
    id: row.id,
    eventKind: row.eventKind,
    reason: row.reason,
    occurredAt: toIso(row.occurredAt) ?? new Date(0).toISOString(),
    actorUserId: row.actorUserId,
    senderAccountId: row.senderAccountId,
    leadAssignmentId: row.leadAssignmentId,
  }));
}

async function loadCampaignTracking(organizationId: string, campaignId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT message."id"
     FROM "V2OutreachMessage" message
     INNER JOIN "V2SequenceEnrollment" enrollment
       ON enrollment."id" = message."enrollmentId"
      AND enrollment."organizationId" = message."organizationId"
      AND enrollment."deletedAt" IS NULL
     WHERE message."organizationId" = $1
       AND enrollment."sequenceId" = $2
       AND message."deletedAt" IS NULL
     LIMIT 10000`,
    organizationId,
    campaignId
  );
  return queryTrackingAnalytics(organizationId, { messageIds: rows.map((row) => row.id) });
}
function groupSteps(rows: StepRow[]): CampaignStep[] {
  const grouped = new Map<string, CampaignStep>();
  for (const row of rows) {
    const step = grouped.get(row.id) ?? {
      id: row.id,
      ordinal: Number(row.ordinal),
      kind: row.kind,
      delayMinutes: Number(row.delayMinutes),
      variants: [],
    };
    if (row.variantId) {
      step.variants.push({
        id: row.variantId,
        key: row.variantKey ?? "A",
        name: row.variantName,
        weight: Number(row.weight ?? 100),
        subjectTemplate: row.subjectTemplate,
        bodyTemplate: row.bodyTemplate,
        requiredVariables: toStringArray(row.requiredVariablesJson),
        assignedCount: Number(row.variantAssignedCount ?? 0),
        sentCount: Number(row.variantSentCount ?? 0),
        repliedCount: Number(row.variantRepliedCount ?? 0),
        bouncedCount: Number(row.variantBouncedCount ?? 0),
        failedCount: Number(row.variantFailedCount ?? 0),
      });
    }
    grouped.set(row.id, step);
  }
  return [...grouped.values()];
}

function normalizeSender(row: SenderRow): CampaignSender {
  return {
    ...row,
    liveSendEnabled: Boolean(row.liveSendEnabled),
    poolEnabled: Boolean(row.poolEnabled),
    poolWeight: Number(row.poolWeight),
    dailyCapCurrent: Number(row.dailyCapCurrent),
    dailyCapTarget: Number(row.dailyCapTarget),
    bounceRate: Number(row.bounceRate),
    complaintRate: Number(row.complaintRate),
  };
}
type StepRow = {
  id: string;
  ordinal: number;
  kind: string;
  delayMinutes: number;
  variantId: string | null;
  variantKey: string | null;
  variantName: string | null;
  weight: number | null;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  requiredVariablesJson: unknown;
  variantAssignedCount: number | null;
  variantSentCount: number | null;
  variantRepliedCount: number | null;
  variantBouncedCount: number | null;
  variantFailedCount: number | null;
};
type SenderRow = {
  poolId: string;
  poolEnabled: boolean;
  poolWeight: number;
  id: string;
  displayName: string;
  fromAddress: string;
  kind: string;
  status: string;
  liveSendEnabled: boolean;
  dailyCapCurrent: number;
  dailyCapTarget: number;
  bounceRate: number;
  complaintRate: number;
  trackingHostname: string | null;
  trackingStatus: string | null;
};

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
