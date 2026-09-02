-- CreateEnum
CREATE TYPE "V2ICPVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "V2ClientAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2ClientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2Offer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2ICPProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2ICPProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2ICPVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "icpProfileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "V2ICPVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "rulesJson" JSONB,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2ICPVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2ClientAccount_organizationId_idx" ON "V2ClientAccount"("organizationId");

-- CreateIndex
CREATE INDEX "V2ClientAccount_status_idx" ON "V2ClientAccount"("status");

-- CreateIndex
CREATE INDEX "V2ClientAccount_createdAt_idx" ON "V2ClientAccount"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2ClientAccount_organizationId_name_key" ON "V2ClientAccount"("organizationId", "name");

-- CreateIndex
CREATE INDEX "V2Project_organizationId_idx" ON "V2Project"("organizationId");

-- CreateIndex
CREATE INDEX "V2Project_clientAccountId_idx" ON "V2Project"("clientAccountId");

-- CreateIndex
CREATE INDEX "V2Project_status_idx" ON "V2Project"("status");

-- CreateIndex
CREATE INDEX "V2Project_createdAt_idx" ON "V2Project"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2Project_organizationId_clientAccountId_name_key" ON "V2Project"("organizationId", "clientAccountId", "name");

-- CreateIndex
CREATE INDEX "V2Offer_organizationId_idx" ON "V2Offer"("organizationId");

-- CreateIndex
CREATE INDEX "V2Offer_projectId_idx" ON "V2Offer"("projectId");

-- CreateIndex
CREATE INDEX "V2Offer_status_idx" ON "V2Offer"("status");

-- CreateIndex
CREATE INDEX "V2Offer_createdAt_idx" ON "V2Offer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2Offer_organizationId_projectId_name_key" ON "V2Offer"("organizationId", "projectId", "name");

-- CreateIndex
CREATE INDEX "V2ICPProfile_organizationId_idx" ON "V2ICPProfile"("organizationId");

-- CreateIndex
CREATE INDEX "V2ICPProfile_offerId_idx" ON "V2ICPProfile"("offerId");

-- CreateIndex
CREATE INDEX "V2ICPProfile_status_idx" ON "V2ICPProfile"("status");

-- CreateIndex
CREATE INDEX "V2ICPProfile_createdAt_idx" ON "V2ICPProfile"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2ICPProfile_organizationId_offerId_name_key" ON "V2ICPProfile"("organizationId", "offerId", "name");

-- CreateIndex
CREATE INDEX "V2ICPVersion_organizationId_idx" ON "V2ICPVersion"("organizationId");

-- CreateIndex
CREATE INDEX "V2ICPVersion_icpProfileId_idx" ON "V2ICPVersion"("icpProfileId");

-- CreateIndex
CREATE INDEX "V2ICPVersion_status_idx" ON "V2ICPVersion"("status");

-- CreateIndex
CREATE INDEX "V2ICPVersion_publishedAt_idx" ON "V2ICPVersion"("publishedAt");

-- CreateIndex
CREATE INDEX "V2ICPVersion_publishedByUserId_idx" ON "V2ICPVersion"("publishedByUserId");

-- CreateIndex
CREATE INDEX "V2ICPVersion_createdAt_idx" ON "V2ICPVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2ICPVersion_organizationId_icpProfileId_versionNumber_key" ON "V2ICPVersion"("organizationId", "icpProfileId", "versionNumber");

-- AddForeignKey
ALTER TABLE "V2ClientAccount" ADD CONSTRAINT "V2ClientAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Project" ADD CONSTRAINT "V2Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Project" ADD CONSTRAINT "V2Project_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "V2ClientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Offer" ADD CONSTRAINT "V2Offer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Offer" ADD CONSTRAINT "V2Offer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "V2Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2ICPProfile" ADD CONSTRAINT "V2ICPProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2ICPProfile" ADD CONSTRAINT "V2ICPProfile_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "V2Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2ICPVersion" ADD CONSTRAINT "V2ICPVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2ICPVersion" ADD CONSTRAINT "V2ICPVersion_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "V2ICPProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2ICPVersion" ADD CONSTRAINT "V2ICPVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
