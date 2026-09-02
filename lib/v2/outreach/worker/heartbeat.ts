import "server-only";

import { prisma } from "@/lib/server/prisma";

// Worker / IMAP-poller liveness. The daemons upsert a heartbeat each loop; live
// campaign launch checks it so a dead daemon can't silently swallow scheduled
// sends. Pure evaluator (evaluateHeartbeat) is unit-tested; the DB I/O is thin.

export const WORKER_KINDS = ["job_worker", "imap_poller"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export const DEFAULT_HEARTBEAT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export type HeartbeatStatus = {
  healthy: boolean;
  reason: "OK" | "STALE" | "NEVER";
  ageMs: number | null;
};

/**
 * Pure freshness policy. A heartbeat older than maxAge is STALE (unhealthy). A
 * missing heartbeat is NEVER — tolerated in dev (no daemon running) but
 * unhealthy in production, where a worker MUST be live before launching.
 */
export function evaluateHeartbeat(
  lastBeatAt: Date | string | null,
  options: { now?: Date; maxAgeMs?: number; isProduction?: boolean } = {}
): HeartbeatStatus {
  const now = options.now ?? new Date();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_HEARTBEAT_MAX_AGE_MS;
  const isProduction = options.isProduction ?? false;

  if (!lastBeatAt) {
    return { healthy: !isProduction, reason: "NEVER", ageMs: null };
  }
  const ageMs = now.getTime() - new Date(lastBeatAt).getTime();
  if (ageMs > maxAgeMs) {
    return { healthy: false, reason: "STALE", ageMs };
  }
  return { healthy: true, reason: "OK", ageMs };
}

export async function recordWorkerHeartbeat(
  workerKind: WorkerKind | string,
  now: Date = new Date()
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2WorkerHeartbeat" ("id", "workerKind", "lastBeatAt", "updatedAt")
     VALUES ($1, $2, $3, $3)
     ON CONFLICT ("workerKind") DO UPDATE SET "lastBeatAt" = $3, "updatedAt" = $3`,
    `hb_${workerKind}`,
    workerKind,
    now
  );
}

export async function checkWorkerHeartbeat(
  workerKind: WorkerKind | string,
  options: { now?: Date; maxAgeMs?: number } = {}
): Promise<HeartbeatStatus> {
  const rows = await prisma.$queryRawUnsafe<Array<{ lastBeatAt: Date }>>(
    `SELECT "lastBeatAt" FROM "V2WorkerHeartbeat" WHERE "workerKind" = $1 LIMIT 1`,
    workerKind
  );
  return evaluateHeartbeat(rows[0]?.lastBeatAt ?? null, {
    ...options,
    isProduction: process.env.NODE_ENV === "production",
  });
}
