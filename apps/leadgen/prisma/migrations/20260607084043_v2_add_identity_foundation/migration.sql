-- CreateEnum
CREATE TYPE "V2ContactIdentifierType" AS ENUM ('EMAIL', 'PHONE', 'LINKEDIN', 'OTHER');

-- CreateEnum
CREATE TYPE "V2ContactIdentifierValidityStatus" AS ENUM ('VALID', 'INVALID', 'BOUNCED', 'SUPPRESSED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "V2Company" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "canonicalDomain" TEXT,
    "websiteUrl" TEXT,
    "linkedinUrl" TEXT,
    "country" TEXT,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "fullNameNormalized" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2ContactIdentifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "V2ContactIdentifierType" NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "rawValue" TEXT,
    "isGeneric" BOOLEAN NOT NULL DEFAULT false,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "validityStatus" "V2ContactIdentifierValidityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2ContactIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2LeadAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "projectId" TEXT NOT NULL,
    "icpVersionId" TEXT NOT NULL,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "V2Company_organizationId_idx" ON "V2Company"("organizationId");

-- CreateIndex
CREATE INDEX "V2Company_nameNormalized_idx" ON "V2Company"("nameNormalized");

-- CreateIndex
CREATE INDEX "V2Company_status_idx" ON "V2Company"("status");

-- CreateIndex
CREATE INDEX "V2Company_createdAt_idx" ON "V2Company"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2Company_organizationId_canonicalDomain_key" ON "V2Company"("organizationId", "canonicalDomain");

-- CreateIndex
CREATE INDEX "V2Contact_organizationId_idx" ON "V2Contact"("organizationId");

-- CreateIndex
CREATE INDEX "V2Contact_fullNameNormalized_idx" ON "V2Contact"("fullNameNormalized");

-- CreateIndex
CREATE INDEX "V2Contact_status_idx" ON "V2Contact"("status");

-- CreateIndex
CREATE INDEX "V2Contact_createdAt_idx" ON "V2Contact"("createdAt");

-- CreateIndex
CREATE INDEX "V2ContactIdentifier_organizationId_idx" ON "V2ContactIdentifier"("organizationId");

-- CreateIndex
CREATE INDEX "V2ContactIdentifier_contactId_idx" ON "V2ContactIdentifier"("contactId");

-- CreateIndex
CREATE INDEX "V2ContactIdentifier_type_normalizedValue_idx" ON "V2ContactIdentifier"("type", "normalizedValue");

-- CreateIndex
CREATE INDEX "V2ContactIdentifier_validityStatus_idx" ON "V2ContactIdentifier"("validityStatus");

-- CreateIndex
CREATE INDEX "V2ContactIdentifier_isGeneric_idx" ON "V2ContactIdentifier"("isGeneric");

-- CreateIndex
CREATE INDEX "V2ContactIdentifier_createdAt_idx" ON "V2ContactIdentifier"("createdAt");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_organizationId_idx" ON "V2LeadAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_companyId_idx" ON "V2LeadAssignment"("companyId");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_contactId_idx" ON "V2LeadAssignment"("contactId");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_projectId_idx" ON "V2LeadAssignment"("projectId");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_icpVersionId_idx" ON "V2LeadAssignment"("icpVersionId");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_status_idx" ON "V2LeadAssignment"("status");

-- CreateIndex
CREATE INDEX "V2LeadAssignment_createdAt_idx" ON "V2LeadAssignment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2ContactIdentifier_org_email_non_generic_key"
ON "V2ContactIdentifier"("organizationId", "normalizedValue")
WHERE "type" = 'EMAIL' AND "isGeneric" = false;

-- CreateIndex
CREATE UNIQUE INDEX "V2ContactIdentifier_org_linkedin_key"
ON "V2ContactIdentifier"("organizationId", "normalizedValue")
WHERE "type" = 'LINKEDIN';

-- CreateIndex
CREATE UNIQUE INDEX "V2LeadAssignment_org_company_contact_project_icp_key"
ON "V2LeadAssignment"("organizationId", "companyId", "contactId", "projectId", "icpVersionId")
WHERE "contactId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "V2LeadAssignment_org_company_project_icp_no_contact_key"
ON "V2LeadAssignment"("organizationId", "companyId", "projectId", "icpVersionId")
WHERE "contactId" IS NULL;

-- AddForeignKey
ALTER TABLE "V2Company" ADD CONSTRAINT "V2Company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2Contact" ADD CONSTRAINT "V2Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2ContactIdentifier" ADD CONSTRAINT "V2ContactIdentifier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2ContactIdentifier" ADD CONSTRAINT "V2ContactIdentifier_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "V2Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2LeadAssignment" ADD CONSTRAINT "V2LeadAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2LeadAssignment" ADD CONSTRAINT "V2LeadAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "V2Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2LeadAssignment" ADD CONSTRAINT "V2LeadAssignment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "V2Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2LeadAssignment" ADD CONSTRAINT "V2LeadAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "V2Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2LeadAssignment" ADD CONSTRAINT "V2LeadAssignment_icpVersionId_fkey" FOREIGN KEY ("icpVersionId") REFERENCES "V2ICPVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
