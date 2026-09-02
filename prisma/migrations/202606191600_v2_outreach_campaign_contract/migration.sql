-- CreateEnum
CREATE TYPE "V2CampaignTimezoneMode" AS ENUM ('LEAD', 'CAMPAIGN', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "V2TrackingDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "V2TrackingEventKind" AS ENUM ('OPEN', 'CLICK');

-- CreateEnum
CREATE TYPE "V2TrackingBotClassification" AS ENUM ('HUMAN', 'BOT', 'SUSPECTED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "V2SenderAccount"
ADD COLUMN "trackingDomainId" TEXT;

-- AlterTable
ALTER TABLE "V2Sequence"
ADD COLUMN "scheduleJson" JSONB,
ADD COLUMN "timezoneMode" "V2CampaignTimezoneMode" NOT NULL DEFAULT 'LEAD',
ADD COLUMN "fallbackTimezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "launchedAt" TIMESTAMP(3),
ADD COLUMN "pausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "V2SequenceEnrollment"
ADD COLUMN "outreachProfileId" TEXT,
ADD COLUMN "recipientEmailSnapshot" TEXT,
ADD COLUMN "timezoneSnapshot" TEXT,
ADD COLUMN "renderContextSnapshotJson" JSONB,
ADD COLUMN "outreachProfileFingerprint" TEXT,
ADD COLUMN "qualificationOverrideReason" TEXT,
ADD COLUMN "qualificationOverrideByUserId" TEXT,
ADD COLUMN "qualificationOverrideAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "V2OutreachMessage"
ADD COLUMN "sequenceStepVariantId" TEXT;

-- CreateTable
CREATE TABLE "V2SequenceSenderAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "V2SequenceSenderAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "V2SequenceSenderAccount_weight_check" CHECK ("weight" > 0)
);

-- CreateTable
CREATE TABLE "V2SequenceStepVariant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceStepId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "name" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subjectTemplate" TEXT,
    "bodyTemplate" TEXT,
    "requiredVariablesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "V2SequenceStepVariant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "V2SequenceStepVariant_weight_check" CHECK ("weight" > 0)
);

-- CreateTable
CREATE TABLE "V2LeadOutreachProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "primaryEmailIdentifierId" TEXT,
    "primaryEmailNormalized" TEXT,
    "timezone" TEXT,
    "mergeDataJson" JSONB,
    "sourceFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "V2LeadOutreachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2TrackingDomain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "cnameTarget" TEXT NOT NULL,
    "status" "V2TrackingDomainStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "V2TrackingDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2OutreachTrackingLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "V2OutreachTrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2OutreachTrackingEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "trackingLinkId" TEXT,
    "eventKind" "V2TrackingEventKind" NOT NULL,
    "botClassification" "V2TrackingBotClassification" NOT NULL DEFAULT 'UNKNOWN',
    "requestFingerprint" TEXT,
    "userAgentHash" TEXT,
    "ipHash" TEXT,
    "metadataJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "V2OutreachTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2OutreachAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT,
    "senderAccountId" TEXT,
    "leadAssignmentId" TEXT,
    "actorUserId" TEXT,
    "eventKind" TEXT NOT NULL,
    "reason" TEXT,
    "payloadJson" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "V2OutreachAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "V2SequenceSenderAccount_org_sequence_sender_key"
ON "V2SequenceSenderAccount"("organizationId", "sequenceId", "senderAccountId");
CREATE UNIQUE INDEX "V2SequenceStepVariant_org_step_key_key"
ON "V2SequenceStepVariant"("organizationId", "sequenceStepId", "variantKey");
-- Backfill each existing EMAIL step as the default A variant.
INSERT INTO "V2SequenceStepVariant" (
    "id", "organizationId", "sequenceStepId", "variantKey", "name", "weight",
    "enabled", "subjectTemplate", "bodyTemplate", "createdAt", "updatedAt"
)
SELECT
    'v2sv_' || md5(step."id"),
    step."organizationId",
    step."id",
    'A',
    'Default',
    100,
    true,
    step."subjectTemplate",
    step."bodyTemplate",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "V2SequenceStep" step
WHERE step."kind" = 'EMAIL'
ON CONFLICT ("organizationId", "sequenceStepId", "variantKey") DO NOTHING;

-- Preserve current sticky senders as the initial campaign sender pool.
INSERT INTO "V2SequenceSenderAccount" (
    "id", "organizationId", "sequenceId", "senderAccountId", "enabled",
    "weight", "createdAt", "updatedAt"
)
SELECT
    'v2ssp_' || md5(enrollment."organizationId" || ':' || enrollment."sequenceId" || ':' || enrollment."senderAccountId"),
    enrollment."organizationId",
    enrollment."sequenceId",
    enrollment."senderAccountId",
    true,
    100,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "V2SequenceEnrollment" enrollment
WHERE enrollment."deletedAt" IS NULL
GROUP BY enrollment."organizationId", enrollment."sequenceId", enrollment."senderAccountId"
ON CONFLICT ("organizationId", "sequenceId", "senderAccountId") DO NOTHING;

CREATE INDEX "V2SenderAccount_organizationId_trackingDomainId_idx"
ON "V2SenderAccount"("organizationId", "trackingDomainId");

CREATE INDEX "V2SequenceSenderAccount_org_sequence_enabled_idx"
ON "V2SequenceSenderAccount"("organizationId", "sequenceId", "enabled");
CREATE INDEX "V2SequenceSenderAccount_org_sender_enabled_idx"
ON "V2SequenceSenderAccount"("organizationId", "senderAccountId", "enabled");

CREATE INDEX "V2SequenceStepVariant_org_step_enabled_idx"
ON "V2SequenceStepVariant"("organizationId", "sequenceStepId", "enabled");

CREATE UNIQUE INDEX "V2LeadOutreachProfile_org_lead_key"
ON "V2LeadOutreachProfile"("organizationId", "leadAssignmentId");
CREATE INDEX "V2LeadOutreachProfile_org_email_idx"
ON "V2LeadOutreachProfile"("organizationId", "primaryEmailNormalized");
CREATE INDEX "V2LeadOutreachProfile_org_timezone_idx"
ON "V2LeadOutreachProfile"("organizationId", "timezone");
CREATE INDEX "V2LeadOutreachProfile_deletedAt_idx"
ON "V2LeadOutreachProfile"("deletedAt");

CREATE INDEX "V2SequenceEnrollment_org_outreachProfile_idx"
ON "V2SequenceEnrollment"("organizationId", "outreachProfileId");
CREATE INDEX "V2OutreachMessage_org_variant_createdAt_idx"
ON "V2OutreachMessage"("organizationId", "sequenceStepVariantId", "createdAt");

CREATE UNIQUE INDEX "V2TrackingDomain_org_hostname_key"
ON "V2TrackingDomain"("organizationId", "hostname");
CREATE INDEX "V2TrackingDomain_org_status_idx"
ON "V2TrackingDomain"("organizationId", "status");
CREATE INDEX "V2TrackingDomain_deletedAt_idx"
ON "V2TrackingDomain"("deletedAt");

CREATE UNIQUE INDEX "V2OutreachTrackingLink_token_key"
ON "V2OutreachTrackingLink"("token");
CREATE INDEX "V2OutreachTrackingLink_org_message_idx"
ON "V2OutreachTrackingLink"("organizationId", "messageId");

CREATE INDEX "V2OutreachTrackingEvent_org_message_kind_time_idx"
ON "V2OutreachTrackingEvent"("organizationId", "messageId", "eventKind", "occurredAt");
CREATE INDEX "V2OutreachTrackingEvent_org_kind_time_idx"
ON "V2OutreachTrackingEvent"("organizationId", "eventKind", "occurredAt");
CREATE INDEX "V2OutreachTrackingEvent_org_fingerprint_idx"
ON "V2OutreachTrackingEvent"("organizationId", "requestFingerprint");

CREATE UNIQUE INDEX "V2OutreachAuditEvent_org_idempotency_key"
ON "V2OutreachAuditEvent"("organizationId", "idempotencyKey");
CREATE INDEX "V2OutreachAuditEvent_org_sequence_time_idx"
ON "V2OutreachAuditEvent"("organizationId", "sequenceId", "occurredAt");
CREATE INDEX "V2OutreachAuditEvent_org_sender_time_idx"
ON "V2OutreachAuditEvent"("organizationId", "senderAccountId", "occurredAt");
CREATE INDEX "V2OutreachAuditEvent_org_lead_time_idx"
ON "V2OutreachAuditEvent"("organizationId", "leadAssignmentId", "occurredAt");
CREATE INDEX "V2OutreachAuditEvent_org_kind_time_idx"
ON "V2OutreachAuditEvent"("organizationId", "eventKind", "occurredAt");