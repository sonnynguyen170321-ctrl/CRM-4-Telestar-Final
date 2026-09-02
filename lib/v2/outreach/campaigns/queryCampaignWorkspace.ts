import "server-only";

import { prisma } from "@/lib/server/prisma";

export type CampaignEmailRow = {
  id: string;
  leadAssignmentId: string;
  contactName: string | null;
  companyName: string | null;
  toAddress: string;
  subject: string | null;
  bodyPreview: string | null;
  status: string;
  stepOrdinal: number | null;
  variantKey: string | null;
  senderDisplayName: string | null;
  senderFromAddress: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type CampaignActivityRow = {
  id: string;
  kind: "activity" | "audit";
  eventKind: string;
  occurredAt: string;
  channel: string | null;
  companyName: string | null;
  contactName: string | null;
  senderFromAddress: string | null;
  reason: string | null;
  messageId: string | null;
};

export type CampaignAvailableSender = {
  id: string;
  displayName: string;
  fromAddress: string;
  status: string;
  liveSendEnabled: boolean;
  verifiedAt: string | null;
  lastVerifyError: string | null;
  dailyCapCurrent: number;
  dailyCapTarget: number;
  alreadyInPool: boolean;
};

export async function queryCampaignEmailRows(
  organizationId: string,
  campaignId: string
): Promise<CampaignEmailRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<Omit<CampaignEmailRow, "scheduledAt" | "sentAt" | "failedAt" | "createdAt"> & {
      scheduledAt: Date | string | null;
      sentAt: Date | string | null;
      failedAt: Date | string | null;
      createdAt: Date | string;
    }>
  >(
    `SELECT
       message."id",
       message."leadAssignmentId",
       contact."fullName" AS "contactName",
       company."name" AS "companyName",
       message."toAddress",
       message."subject",
       LEFT(COALESCE(message."bodyRef", ''), 220) AS "bodyPreview",
       message."status"::text AS "status",
       step."ordinal" AS "stepOrdinal",
       variant."variantKey",
       sender."displayName" AS "senderDisplayName",
       sender."fromAddress" AS "senderFromAddress",
       enrollment."nextStepAt" AS "scheduledAt",
       message."sentAt",
       message."failedAt",
       message."errorCode",
       message."errorMessage",
       message."createdAt"
     FROM "V2OutreachMessage" message
     INNER JOIN "V2SequenceEnrollment" enrollment
       ON enrollment."id" = message."enrollmentId"
      AND enrollment."organizationId" = message."organizationId"
      AND enrollment."deletedAt" IS NULL
     INNER JOIN "V2LeadAssignment" lead
       ON lead."id" = message."leadAssignmentId"
      AND lead."organizationId" = message."organizationId"
      AND lead."status" = 'ACTIVE' AND lead."deletedAt" IS NULL
     LEFT JOIN "V2Contact" contact
       ON contact."id" = message."contactId"
      AND contact."organizationId" = message."organizationId"
      AND contact."status" = 'ACTIVE' AND contact."deletedAt" IS NULL
     LEFT JOIN "V2Company" company
       ON company."id" = lead."companyId"
      AND company."organizationId" = lead."organizationId"
      AND company."status" = 'ACTIVE' AND company."deletedAt" IS NULL
     LEFT JOIN "V2SenderAccount" sender
       ON sender."id" = message."senderAccountId"
      AND sender."organizationId" = message."organizationId"
      AND sender."deletedAt" IS NULL
     LEFT JOIN "V2SequenceStep" step
       ON step."id" = message."sequenceStepId"
      AND step."organizationId" = message."organizationId"
     LEFT JOIN "V2SequenceStepVariant" variant
       ON variant."id" = message."sequenceStepVariantId"
      AND variant."organizationId" = message."organizationId"
     WHERE message."organizationId" = $1
       AND enrollment."sequenceId" = $2
       AND message."deletedAt" IS NULL
     ORDER BY COALESCE(message."sentAt", message."sendingAt", message."createdAt") DESC
     LIMIT 200`,
    organizationId,
    campaignId
  );

  return rows.map((row) => ({
    ...row,
    stepOrdinal: row.stepOrdinal == null ? null : Number(row.stepOrdinal),
    scheduledAt: toIso(row.scheduledAt),
    sentAt: toIso(row.sentAt),
    failedAt: toIso(row.failedAt),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
  }));
}

export async function queryCampaignActivityRows(
  organizationId: string,
  campaignId: string
): Promise<CampaignActivityRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<Omit<CampaignActivityRow, "kind" | "occurredAt"> & {
      kind: string;
      occurredAt: Date | string;
    }>
  >(
    `SELECT *
     FROM (
       SELECT
         activity."id",
         'activity' AS "kind",
         activity."eventKind",
         activity."occurredAt",
         activity."channel",
         company."name" AS "companyName",
         contact."fullName" AS "contactName",
         sender."fromAddress" AS "senderFromAddress",
         NULL::text AS "reason",
         activity."messageId"
       FROM "V2OutreachActivity" activity
       INNER JOIN "V2SequenceEnrollment" enrollment
         ON enrollment."leadAssignmentId" = activity."leadAssignmentId"
        AND enrollment."organizationId" = activity."organizationId"
        AND enrollment."sequenceId" = $2
        AND enrollment."deletedAt" IS NULL
       LEFT JOIN "V2LeadAssignment" lead
         ON lead."id" = activity."leadAssignmentId"
        AND lead."organizationId" = activity."organizationId"
        AND lead."status" = 'ACTIVE' AND lead."deletedAt" IS NULL
       LEFT JOIN "V2Company" company
         ON company."id" = lead."companyId"
        AND company."organizationId" = lead."organizationId"
        AND company."status" = 'ACTIVE' AND company."deletedAt" IS NULL
       LEFT JOIN "V2Contact" contact
         ON contact."id" = activity."contactId"
        AND contact."organizationId" = activity."organizationId"
        AND contact."status" = 'ACTIVE' AND contact."deletedAt" IS NULL
       LEFT JOIN "V2OutreachMessage" message
         ON message."id" = activity."messageId"
        AND message."organizationId" = activity."organizationId"
       LEFT JOIN "V2SenderAccount" sender
         ON sender."id" = message."senderAccountId"
        AND sender."organizationId" = activity."organizationId"
       WHERE activity."organizationId" = $1
       UNION ALL
       SELECT
         audit."id",
         'audit' AS "kind",
         audit."eventKind",
         audit."occurredAt",
         'audit' AS "channel",
         company."name" AS "companyName",
         contact."fullName" AS "contactName",
         sender."fromAddress" AS "senderFromAddress",
         audit."reason",
         NULL::text AS "messageId"
       FROM "V2OutreachAuditEvent" audit
       LEFT JOIN "V2LeadAssignment" lead
         ON lead."id" = audit."leadAssignmentId"
        AND lead."organizationId" = audit."organizationId"
        AND lead."status" = 'ACTIVE' AND lead."deletedAt" IS NULL
       LEFT JOIN "V2Company" company
         ON company."id" = lead."companyId"
        AND company."organizationId" = lead."organizationId"
        AND company."status" = 'ACTIVE' AND company."deletedAt" IS NULL
       LEFT JOIN "V2Contact" contact
         ON contact."id" = lead."contactId"
        AND contact."organizationId" = lead."organizationId"
        AND contact."status" = 'ACTIVE' AND contact."deletedAt" IS NULL
       LEFT JOIN "V2SenderAccount" sender
         ON sender."id" = audit."senderAccountId"
        AND sender."organizationId" = audit."organizationId"
       WHERE audit."organizationId" = $1
         AND audit."sequenceId" = $2
     ) rows
     ORDER BY rows."occurredAt" DESC
     LIMIT 200`,
    organizationId,
    campaignId
  );

  return rows.map((row) => ({
    ...row,
    kind: row.kind === "audit" ? "audit" : "activity",
    occurredAt: toIso(row.occurredAt) ?? new Date(0).toISOString(),
  }));
}

export async function queryCampaignAvailableSenders(
  organizationId: string,
  campaignId: string
): Promise<CampaignAvailableSender[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<Omit<CampaignAvailableSender, "verifiedAt"> & { verifiedAt: Date | string | null }>
  >(
    `SELECT
       sender."id",
       sender."displayName",
       sender."fromAddress",
       sender."status"::text AS "status",
       sender."liveSendEnabled",
       sender."verifiedAt",
       sender."lastVerifyError",
       sender."dailyCapCurrent",
       sender."dailyCapTarget",
       EXISTS (
         SELECT 1 FROM "V2SequenceSenderAccount" pool
         WHERE pool."organizationId" = sender."organizationId"
           AND pool."sequenceId" = $2
           AND pool."senderAccountId" = sender."id"
       ) AS "alreadyInPool"
     FROM "V2SenderAccount" sender
     WHERE sender."organizationId" = $1
       AND sender."deletedAt" IS NULL
     ORDER BY sender."liveSendEnabled" DESC, sender."verifiedAt" DESC NULLS LAST, sender."displayName" ASC
     LIMIT 100`,
    organizationId,
    campaignId
  );

  return rows.map((row) => ({
    ...row,
    liveSendEnabled: Boolean(row.liveSendEnabled),
    alreadyInPool: Boolean(row.alreadyInPool),
    dailyCapCurrent: Number(row.dailyCapCurrent),
    dailyCapTarget: Number(row.dailyCapTarget),
    verifiedAt: toIso(row.verifiedAt),
  }));
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
