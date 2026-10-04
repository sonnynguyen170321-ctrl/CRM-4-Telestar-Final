-- Telephony core (docs/dialer/): Call, TelephonyCredential, TelephonyNumber, TelephonyEvent (deployment-wide
-- webhook inbox), TelephonySettings, PhoneSuppression; do-not-call fields and a normalizedPhone index on Lead and
-- Contact. Composite tenant foreign keys use SET NULL on the link column only (as in
-- 20260827000000_composite_tenant_foreign_keys), so deleting a lead or user never nulls tenantId.

-- Fail fast instead of queueing behind a long transaction on Lead or Contact during a deploy.
SET lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('authorized', 'blocked', 'initiated', 'ringing', 'answered', 'completed', 'no_answer', 'busy', 'failed', 'missed', 'canceled');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('connected_interested', 'connected_not_interested', 'meeting_booked', 'callback_requested', 'gatekeeper', 'voicemail_left', 'no_answer', 'wrong_number', 'do_not_call');

-- CreateEnum
CREATE TYPE "PhoneSuppressionSource" AS ENUM ('manual', 'call_outcome', 'lead_request', 'wrong_number', 'complaint');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "doNotCall" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "doNotCallAt" TIMESTAMP(3),
ADD COLUMN     "doNotCallReason" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "doNotCall" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "doNotCallAt" TIMESTAMP(3),
ADD COLUMN     "doNotCallReason" TEXT;

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "status" "CallStatus" NOT NULL,
    "userId" TEXT,
    "leadId" TEXT,
    "contactId" TEXT,
    "toE164" TEXT NOT NULL,
    "fromE164" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'telnyx',
    "providerSessionId" TEXT,
    "providerControlId" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "initiatedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "billedDurationSec" INTEGER,
    "hangupCause" TEXT,
    "outcome" "CallOutcome",
    "notes" TEXT,
    "compliance" JSONB,
    "blockedReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recordingProviderId" TEXT,
    "recordingPurgeAt" TIMESTAMP(3),
    "activityId" TEXT,
    "missedCallTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelephonyCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'telnyx',
    "providerCredentialId" TEXT NOT NULL,
    "sipUsername" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastTokenAt" TIMESTAMP(3),
    "lastRegisteredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TelephonyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelephonyNumber" (
    "id" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'telnyx',
    "providerNumberId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'both',
    "country" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TelephonyNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelephonyEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'telnyx',
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sessionId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "TelephonyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelephonySettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "callingHoursStart" INTEGER NOT NULL DEFAULT 480,
    "callingHoursEnd" INTEGER NOT NULL DEFAULT 1020,
    "allowedWeekdays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "allowedCountries" TEXT[] DEFAULT ARRAY['VN']::TEXT[],
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recordingRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "inboundRingSecs" INTEGER NOT NULL DEFAULT 20,
    "fallbackUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "killedAt" TIMESTAMP(3),
    "killedById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TelephonySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneSuppression" (
    "id" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "source" "PhoneSuppressionSource" NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "PhoneSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_activityId_key" ON "Call"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_missedCallTaskId_key" ON "Call"("missedCallTaskId");

-- CreateIndex
CREATE INDEX "Call_tenantId_userId_createdAt_idx" ON "Call"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_tenantId_leadId_createdAt_idx" ON "Call"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_tenantId_status_createdAt_idx" ON "Call"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Call_tenantId_toE164_createdAt_idx" ON "Call"("tenantId", "toE164", "createdAt");

-- CreateIndex
CREATE INDEX "Call_recordingPurgeAt_idx" ON "Call"("recordingPurgeAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_id_tenantId_key" ON "Call"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_provider_providerSessionId_key" ON "Call"("provider", "providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyCredential_providerCredentialId_key" ON "TelephonyCredential"("providerCredentialId");

-- CreateIndex
CREATE INDEX "TelephonyCredential_tenantId_idx" ON "TelephonyCredential"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyCredential_id_tenantId_key" ON "TelephonyCredential"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyCredential_userId_tenantId_key" ON "TelephonyCredential"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyNumber_e164_key" ON "TelephonyNumber"("e164");

-- CreateIndex
CREATE INDEX "TelephonyNumber_tenantId_idx" ON "TelephonyNumber"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyNumber_id_tenantId_key" ON "TelephonyNumber"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyEvent_providerEventId_key" ON "TelephonyEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "TelephonyEvent_processedAt_receivedAt_idx" ON "TelephonyEvent"("processedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "TelephonyEvent_sessionId_idx" ON "TelephonyEvent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TelephonySettings_tenantId_key" ON "TelephonySettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneSuppression_tenantId_e164_key" ON "PhoneSuppression"("tenantId", "e164");

-- CreateIndex
CREATE INDEX "Contact_tenantId_normalizedPhone_idx" ON "Contact"("tenantId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "Lead_tenantId_normalizedPhone_idx" ON "Lead"("tenantId", "normalizedPhone");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("userId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE SET NULL ("contactId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelephonyCredential" ADD CONSTRAINT "TelephonyCredential_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelephonyCredential" ADD CONSTRAINT "TelephonyCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelephonyNumber" ADD CONSTRAINT "TelephonyNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelephonySettings" ADD CONSTRAINT "TelephonySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneSuppression" ADD CONSTRAINT "PhoneSuppression_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "Call_providerControlId_idx" ON "Call"("providerControlId");

-- Guards Prisma cannot express. A bad value here would be silent and expensive: a retention of 0 purges
-- recordings the moment they arrive, inverted hours block every call, and a number not in E.164 form
-- produces a do-not-call entry that never matches anything.
ALTER TABLE "TelephonySettings" ADD CONSTRAINT "TelephonySettings_calling_hours_check"
  CHECK ("callingHoursStart" >= 0 AND "callingHoursStart" < "callingHoursEnd" AND "callingHoursEnd" <= 1440);
ALTER TABLE "TelephonySettings" ADD CONSTRAINT "TelephonySettings_retention_check" CHECK ("recordingRetentionDays" > 0);
ALTER TABLE "TelephonySettings" ADD CONSTRAINT "TelephonySettings_ring_check" CHECK ("inboundRingSecs" > 0);
ALTER TABLE "TelephonySettings" ADD CONSTRAINT "TelephonySettings_weekdays_check"
  CHECK ("allowedWeekdays" <@ ARRAY[0,1,2,3,4,5,6]);
ALTER TABLE "Call" ADD CONSTRAINT "Call_billed_duration_check" CHECK ("billedDurationSec" IS NULL OR "billedDurationSec" >= 0);
ALTER TABLE "Call" ADD CONSTRAINT "Call_to_e164_check" CHECK ("toE164" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "PhoneSuppression" ADD CONSTRAINT "PhoneSuppression_e164_check" CHECK ("e164" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "TelephonyNumber" ADD CONSTRAINT "TelephonyNumber_e164_check" CHECK ("e164" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "TelephonyNumber" ADD CONSTRAINT "TelephonyNumber_purpose_check" CHECK ("purpose" IN ('outbound', 'inbound', 'both'));
ALTER TABLE "TelephonyCredential" ADD CONSTRAINT "TelephonyCredential_status_check" CHECK ("status" IN ('active', 'revoked'));
