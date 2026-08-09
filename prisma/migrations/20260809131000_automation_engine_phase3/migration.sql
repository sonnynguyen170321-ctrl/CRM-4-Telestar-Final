-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "sendWindowStartMinutes" INTEGER,
ADD COLUMN     "sendWindowEndMinutes" INTEGER;

-- AlterTable
ALTER TABLE "SequenceEnrollment" ADD COLUMN     "nextActionAt" TIMESTAMP(3),
ADD COLUMN     "pausedReason" TEXT,
ADD COLUMN     "lastTransitionAt" TIMESTAMP(3),
ADD COLUMN     "lastEvaluatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SequenceEnrollment_nextActionAt_idx" ON "SequenceEnrollment"("nextActionAt");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_status_nextActionAt_idx" ON "SequenceEnrollment"("status", "nextActionAt");
