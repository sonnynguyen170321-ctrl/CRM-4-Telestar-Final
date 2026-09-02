-- Contact employment history (person-centric; models job change without
-- duplicating the contact). Soft FKs, app-enforced integrity.
CREATE TABLE "V2ContactEmployment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "title" TEXT,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "V2ContactEmployment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "V2ContactEmployment_organizationId_contactId_idx" ON "V2ContactEmployment"("organizationId", "contactId");
CREATE INDEX "V2ContactEmployment_organizationId_companyId_idx" ON "V2ContactEmployment"("organizationId", "companyId");
CREATE INDEX "V2ContactEmployment_contactId_isCurrent_idx" ON "V2ContactEmployment"("contactId", "isCurrent");
