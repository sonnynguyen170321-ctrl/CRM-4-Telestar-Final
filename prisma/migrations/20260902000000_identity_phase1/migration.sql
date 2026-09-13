-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "canonicalDomain" TEXT,
ADD COLUMN     "nameNormalized" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "fullNameNormalized" TEXT,
ADD COLUMN     "normalizedCompany" TEXT;

-- AlterTable
ALTER TABLE "LeadPoolItem" ADD COLUMN     "normalizedCompany" TEXT;

-- CreateTable
CREATE TABLE "ContactEmployment" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "ContactEmployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactEmployment_tenantId_idx" ON "ContactEmployment"("tenantId");

-- CreateIndex
CREATE INDEX "ContactEmployment_tenantId_accountId_idx" ON "ContactEmployment"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "ContactEmployment_contactId_isCurrent_idx" ON "ContactEmployment"("contactId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEmployment_id_tenantId_key" ON "ContactEmployment"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEmployment_tenantId_contactId_accountId_key" ON "ContactEmployment"("tenantId", "contactId", "accountId");

-- CreateIndex
CREATE INDEX "Account_tenantId_canonicalDomain_idx" ON "Account"("tenantId", "canonicalDomain");

-- CreateIndex
CREATE INDEX "Account_tenantId_nameNormalized_idx" ON "Account"("tenantId", "nameNormalized");

-- CreateIndex
CREATE INDEX "Contact_tenantId_accountId_idx" ON "Contact"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_normalizedCompany_idx" ON "Contact"("tenantId", "normalizedCompany");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEmployment" ADD CONSTRAINT "ContactEmployment_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEmployment" ADD CONSTRAINT "ContactEmployment_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEmployment" ADD CONSTRAINT "ContactEmployment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

