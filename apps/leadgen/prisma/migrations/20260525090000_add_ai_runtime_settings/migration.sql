-- CreateTable
CREATE TABLE "AiRuntimeSetting" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "scoringMode" TEXT,
    "maxRowsPerUpload" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRuntimeSetting_pkey" PRIMARY KEY ("id")
);
