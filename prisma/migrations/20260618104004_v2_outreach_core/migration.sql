
-- CreateEnum
CREATE TYPE "V2SenderKind" AS ENUM ('RELAY', 'MAILBOX');

-- CreateEnum
CREATE TYPE "V2SenderStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DEGRADED', 'DISABLED');

-- CreateEnum
CREATE TYPE "V2OutreachMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'BOUNCED', 'REPLIED');

-- CreateEnum
CREATE TYPE "V2SequenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "V2SequenceStepKind" AS ENUM ('EMAIL', 'WAIT', 'BRANCH', 'CALL_TASK', 'LINKEDIN', 'GOAL');

-- CreateEnum
CREATE TYPE "V2EnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'HALTED');

-- CreateEnum
CREATE TYPE "V2InboundEventKind" AS ENUM ('REPLY', 'BOUNCE_DSN', 'COMPLAINT', 'UNSUBSCRIBE', 'UNCORRELATED');

-- CreateTable
CREATE TABLE "V2SenderAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "V2SenderKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "domain" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpAuthEnc" JSONB NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapSecure" BOOLEAN,
    "imapAuthEnc" JSONB,
    "returnPathAddress" TEXT,
    "rateLimitPerMinute" INTEGER,
    "rateLimitPerHour" INTEGER,
    "dailyCapTarget" INTEGER NOT NULL DEFAULT 0,
    "dailyCapCurrent" INTEGER NOT NULL DEFAULT 0,
    "warmupStage" INTEGER NOT NULL DEFAULT 0,
    "warmupStartedAt" TIMESTAMP(3),
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "complaintRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sentCountWindow" INTEGER NOT NULL DEFAULT 0,
    "bounceCountWindow" INTEGER NOT NULL DEFAULT 0,
    "healthWindowStartedAt" TIMESTAMP(3),
    "status" "V2SenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "liveSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSendAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "V2SenderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2SenderDailySend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "sendDate" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2SenderDailySend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2Sequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "V2SequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnBounce" BOOLEAN NOT NULL DEFAULT true,
    "stopOnMeeting" BOOLEAN NOT NULL DEFAULT true,
    "maxTouches" INTEGER,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "V2Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2SequenceStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "V2SequenceStepKind" NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "sendWindowJson" JSONB,
    "subjectTemplate" TEXT,
    "bodyTemplate" TEXT,
    "branchConfigJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2SequenceEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "contactId" TEXT,
    "senderAccountId" TEXT NOT NULL,
    "status" "V2EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStepOrdinal" INTEGER NOT NULL DEFAULT 0,
    "haltReason" TEXT,
    "nextStepAt" TIMESTAMP(3),
    "enrolledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "V2SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2OutreachMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "contactId" TEXT,
    "senderAccountId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "sequenceStepId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "inReplyToId" TEXT,
    "status" "V2OutreachMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "sendAttemptToken" TEXT,
    "sendingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "bodyRef" TEXT,
    "listUnsubscribeToken" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "V2OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2OutreachActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadAssignmentId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "actorUserId" TEXT,
    "channel" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2OutreachActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2InboundMailEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "mailboxUid" TEXT NOT NULL,
    "messageId" TEXT,
    "eventKind" "V2InboundEventKind" NOT NULL,
    "correlatedMessageId" TEXT,
    "correlatedLeadAssignmentId" TEXT,
    "dsnStatus" TEXT,
    "fromAddress" TEXT,
    "subject" TEXT,
    "rawHeadersRef" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2InboundMailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2SenderAccount_organizationId_status_idx" ON "V2SenderAccount"("organizationId", "status");

-- CreateIndex
CREATE INDEX "V2SenderAccount_organizationId_kind_status_idx" ON "V2SenderAccount"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "V2SenderAccount_organizationId_domain_idx" ON "V2SenderAccount"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "V2SenderAccount_deletedAt_idx" ON "V2SenderAccount"("deletedAt");

-- CreateIndex
CREATE INDEX "V2SenderDailySend_organizationId_sendDate_idx" ON "V2SenderDailySend"("organizationId", "sendDate");

-- CreateIndex
CREATE UNIQUE INDEX "V2SenderDailySend_senderAccountId_sendDate_key" ON "V2SenderDailySend"("senderAccountId", "sendDate");

-- CreateIndex
CREATE INDEX "V2Sequence_organizationId_status_idx" ON "V2Sequence"("organizationId", "status");

-- CreateIndex
CREATE INDEX "V2Sequence_deletedAt_idx" ON "V2Sequence"("deletedAt");

-- CreateIndex
CREATE INDEX "V2SequenceStep_organizationId_sequenceId_idx" ON "V2SequenceStep"("organizationId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "V2SequenceStep_sequenceId_ordinal_key" ON "V2SequenceStep"("sequenceId", "ordinal");

-- CreateIndex
CREATE INDEX "V2SequenceEnrollment_organizationId_status_nextStepAt_idx" ON "V2SequenceEnrollment"("organizationId", "status", "nextStepAt");

-- CreateIndex
CREATE INDEX "V2SequenceEnrollment_organizationId_senderAccountId_idx" ON "V2SequenceEnrollment"("organizationId", "senderAccountId");

-- CreateIndex
CREATE INDEX "V2SequenceEnrollment_organizationId_leadAssignmentId_idx" ON "V2SequenceEnrollment"("organizationId", "leadAssignmentId");

-- CreateIndex
CREATE INDEX "V2SequenceEnrollment_deletedAt_idx" ON "V2SequenceEnrollment"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2SequenceEnrollment_organizationId_sequenceId_leadAssignme_key" ON "V2SequenceEnrollment"("organizationId", "sequenceId", "leadAssignmentId");

-- CreateIndex
CREATE INDEX "V2OutreachMessage_organizationId_status_createdAt_idx" ON "V2OutreachMessage"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "V2OutreachMessage_organizationId_leadAssignmentId_createdAt_idx" ON "V2OutreachMessage"("organizationId", "leadAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "V2OutreachMessage_senderAccountId_sentAt_idx" ON "V2OutreachMessage"("senderAccountId", "sentAt");

-- CreateIndex
CREATE INDEX "V2OutreachMessage_deletedAt_idx" ON "V2OutreachMessage"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2OutreachMessage_organizationId_idempotencyKey_key" ON "V2OutreachMessage"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "V2OutreachMessage_providerMessageId_key" ON "V2OutreachMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "V2OutreachActivity_organizationId_leadAssignmentId_occurred_idx" ON "V2OutreachActivity"("organizationId", "leadAssignmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "V2OutreachActivity_organizationId_occurredAt_idx" ON "V2OutreachActivity"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "V2OutreachActivity_organizationId_eventKind_idx" ON "V2OutreachActivity"("organizationId", "eventKind");

-- CreateIndex
CREATE INDEX "V2InboundMailEvent_organizationId_eventKind_createdAt_idx" ON "V2InboundMailEvent"("organizationId", "eventKind", "createdAt");

-- CreateIndex
CREATE INDEX "V2InboundMailEvent_organizationId_correlatedMessageId_idx" ON "V2InboundMailEvent"("organizationId", "correlatedMessageId");

-- CreateIndex
CREATE INDEX "V2InboundMailEvent_senderAccountId_createdAt_idx" ON "V2InboundMailEvent"("senderAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2InboundMailEvent_senderAccountId_mailboxUid_key" ON "V2InboundMailEvent"("senderAccountId", "mailboxUid");

