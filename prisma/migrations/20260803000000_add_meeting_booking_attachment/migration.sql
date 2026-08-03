-- CreateEnum
CREATE TYPE "BookingLinkProvider" AS ENUM ('calendly', 'google_calendar', 'hubspot', 'microsoft_bookings', 'salesloft', 'other');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('link_sent', 'scheduled', 'completed', 'no_show', 'cancelled', 'rescheduled');

-- CreateEnum
CREATE TYPE "MeetingOutcome" AS ENUM ('qualified_opportunity', 'completed_not_qualified', 'no_show', 'cancelled', 'rescheduled', 'no_decision', 'other');

-- CreateTable
CREATE TABLE "BookingLink" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "provider" "BookingLinkProvider" NOT NULL DEFAULT 'other',
    "ownerName" TEXT,
    "ownerEmail" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "instructions" TEXT,
    "qualificationNotes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "BookingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sdrId" TEXT NOT NULL,
    "bookingLinkId" TEXT,
    "bookingLinkUrlSnapshot" TEXT,
    "bookingLinkNameSnapshot" TEXT,
    "sourceChannel" "Channel",
    "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled',
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT,
    "meetingUrl" TEXT,
    "prospectName" TEXT,
    "prospectEmail" TEXT,
    "clientOwnerName" TEXT,
    "clientOwnerEmail" TEXT,
    "externalEventId" TEXT,
    "externalEventUrl" TEXT,
    "outcome" "MeetingOutcome",
    "outcomeNotes" TEXT,
    "painPoints" TEXT,
    "nextStep" TEXT,
    "outcomeLoggedById" TEXT,
    "outcomeLoggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingLink_tenantId_idx" ON "BookingLink"("tenantId");

-- CreateIndex
CREATE INDEX "BookingLink_clientId_idx" ON "BookingLink"("clientId");

-- CreateIndex
CREATE INDEX "BookingLink_campaignId_idx" ON "BookingLink"("campaignId");

-- CreateIndex
CREATE INDEX "BookingLink_clientId_isDefault_idx" ON "BookingLink"("clientId", "isDefault");

-- CreateIndex
CREATE INDEX "BookingLink_campaignId_isDefault_idx" ON "BookingLink"("campaignId", "isDefault");

-- CreateIndex
CREATE INDEX "BookingLink_isActive_idx" ON "BookingLink"("isActive");

-- CreateIndex
CREATE INDEX "Meeting_tenantId_idx" ON "Meeting"("tenantId");

-- CreateIndex
CREATE INDEX "Meeting_leadId_idx" ON "Meeting"("leadId");

-- CreateIndex
CREATE INDEX "Meeting_clientId_idx" ON "Meeting"("clientId");

-- CreateIndex
CREATE INDEX "Meeting_campaignId_idx" ON "Meeting"("campaignId");

-- CreateIndex
CREATE INDEX "Meeting_sdrId_idx" ON "Meeting"("sdrId");

-- CreateIndex
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

-- CreateIndex
CREATE INDEX "Meeting_scheduledAt_idx" ON "Meeting"("scheduledAt");

-- CreateIndex
CREATE INDEX "Meeting_tenantId_status_scheduledAt_idx" ON "Meeting"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Attachment_templateId_idx" ON "Attachment"("templateId");

-- CreateIndex
CREATE INDEX "Attachment_tenantId_idx" ON "Attachment"("tenantId");

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_sdrId_fkey" FOREIGN KEY ("sdrId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_bookingLinkId_fkey" FOREIGN KEY ("bookingLinkId") REFERENCES "BookingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_outcomeLoggedById_fkey" FOREIGN KEY ("outcomeLoggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

