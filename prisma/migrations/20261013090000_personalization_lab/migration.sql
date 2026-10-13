-- Personalization lab: sender details for merge fields and saved AI variables per lead.
-- Additive and nullable: the previous image runs on this schema unchanged. No new table, so no
-- RLS reapply is needed (User and LeadAiInsight are already covered).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "calendarLink" TEXT;

-- AlterTable
ALTER TABLE "LeadAiInsight" ADD COLUMN     "variablesJson" JSONB,
ADD COLUMN     "variablesGeneratedAt" TIMESTAMP(3);
