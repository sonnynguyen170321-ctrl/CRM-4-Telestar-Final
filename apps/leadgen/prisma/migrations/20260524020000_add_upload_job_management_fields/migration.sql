-- Add archive and soft-delete fields for internal upload job management.
ALTER TABLE "UploadJob"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "UploadJob_createdAt_idx" ON "UploadJob"("createdAt");
CREATE INDEX "UploadJob_archivedAt_idx" ON "UploadJob"("archivedAt");
CREATE INDEX "UploadJob_deletedAt_idx" ON "UploadJob"("deletedAt");
