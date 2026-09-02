-- CreateEnum
CREATE TYPE "V2RecordStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "V2MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'TEAM_LEAD', 'SDR', 'VIEWER');

-- CreateEnum
CREATE TYPE "V2MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateTable
CREATE TABLE "V2Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "name" TEXT,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "V2RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "role" "V2MembershipRole" NOT NULL,
    "status" "V2MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "V2OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "V2AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "V2Organization_slug_key" ON "V2Organization"("slug");

-- CreateIndex
CREATE INDEX "V2Organization_status_idx" ON "V2Organization"("status");

-- CreateIndex
CREATE INDEX "V2Organization_createdAt_idx" ON "V2Organization"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "V2User_emailNormalized_key" ON "V2User"("emailNormalized");

-- CreateIndex
CREATE INDEX "V2User_status_idx" ON "V2User"("status");

-- CreateIndex
CREATE INDEX "V2User_createdAt_idx" ON "V2User"("createdAt");

-- CreateIndex
CREATE INDEX "V2Team_organizationId_idx" ON "V2Team"("organizationId");

-- CreateIndex
CREATE INDEX "V2Team_status_idx" ON "V2Team"("status");

-- CreateIndex
CREATE UNIQUE INDEX "V2Team_organizationId_name_key" ON "V2Team"("organizationId", "name");

-- CreateIndex
CREATE INDEX "V2OrganizationMembership_userId_idx" ON "V2OrganizationMembership"("userId");

-- CreateIndex
CREATE INDEX "V2OrganizationMembership_teamId_idx" ON "V2OrganizationMembership"("teamId");

-- CreateIndex
CREATE INDEX "V2OrganizationMembership_role_idx" ON "V2OrganizationMembership"("role");

-- CreateIndex
CREATE INDEX "V2OrganizationMembership_status_idx" ON "V2OrganizationMembership"("status");

-- CreateIndex
CREATE UNIQUE INDEX "V2OrganizationMembership_organizationId_userId_key" ON "V2OrganizationMembership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "V2AuditEvent_organizationId_createdAt_idx" ON "V2AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "V2AuditEvent_actorUserId_createdAt_idx" ON "V2AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "V2AuditEvent_entityType_entityId_idx" ON "V2AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "V2AuditEvent_eventType_idx" ON "V2AuditEvent"("eventType");

-- CreateIndex
CREATE INDEX "V2AuditEvent_createdAt_idx" ON "V2AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "V2Team" ADD CONSTRAINT "V2Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2OrganizationMembership" ADD CONSTRAINT "V2OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2OrganizationMembership" ADD CONSTRAINT "V2OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "V2User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2OrganizationMembership" ADD CONSTRAINT "V2OrganizationMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "V2Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2AuditEvent" ADD CONSTRAINT "V2AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "V2Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "V2AuditEvent" ADD CONSTRAINT "V2AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "V2User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
