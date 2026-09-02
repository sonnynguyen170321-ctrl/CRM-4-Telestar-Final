-- Worker / IMAP-poller liveness heartbeat. Stale heartbeat blocks live launch.
CREATE TABLE "V2WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "workerKind" TEXT NOT NULL,
  "lastBeatAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "V2WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "V2WorkerHeartbeat_workerKind_key" ON "V2WorkerHeartbeat"("workerKind");
