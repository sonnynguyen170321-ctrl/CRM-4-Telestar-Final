import "server-only";

import {
  evaluateHeartbeat,
  WORKER_KINDS,
  type WorkerKind,
} from "@/lib/v2/outreach/worker/heartbeat";

// Worker liveness + job backlog, so a dead worker (or no worker at all) with queued
// work is VISIBLE instead of silently stalling. The shaping is pure + testable; the DB
// loader is thin. Reuses the existing evaluateHeartbeat freshness policy.

export type WorkerHealthEntry = {
  kind: WorkerKind;
  lastBeatAt: string | null;
  healthy: boolean;
  reason: "OK" | "STALE" | "NEVER";
  ageMs: number | null;
};

export type WorkerHealth = {
  workers: WorkerHealthEntry[];
  backlog: { queued: number; running: number; retryScheduled: number };
  /** A human warning when work is waiting but the job worker isn't live. */
  warning: string | null;
};

export function shapeWorkerHealth(input: {
  heartbeats: Array<{ workerKind: string; lastBeatAt: Date | string | null }>;
  backlog: { queued: number; running: number; retryScheduled: number };
  now?: Date;
  isProduction?: boolean;
}): WorkerHealth {
  const beatByKind = new Map(input.heartbeats.map((h) => [h.workerKind, h.lastBeatAt]));

  const workers: WorkerHealthEntry[] = WORKER_KINDS.map((kind) => {
    const lastBeatAt = beatByKind.get(kind) ?? null;
    const status = evaluateHeartbeat(lastBeatAt, {
      now: input.now,
      isProduction: input.isProduction,
    });
    return {
      kind,
      lastBeatAt: lastBeatAt ? new Date(lastBeatAt).toISOString() : null,
      healthy: status.healthy,
      reason: status.reason,
      ageMs: status.ageMs,
    };
  });

  const jobWorker = workers.find((w) => w.kind === "job_worker");
  const pending = input.backlog.queued + input.backlog.retryScheduled;
  const warning =
    jobWorker && !jobWorker.healthy && pending > 0
      ? `Job worker is ${jobWorker.reason === "NEVER" ? "not running" : "stale"} while ${pending} job${pending === 1 ? "" : "s"} wait. Start it with: npm run v2:worker`
      : null;

  return { workers, backlog: input.backlog, warning };
}

export async function queryWorkerHealth(): Promise<WorkerHealth> {
  const { prisma } = await import("@/lib/server/prisma");
  const [heartbeats, backlogRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ workerKind: string; lastBeatAt: Date }>>(
      `SELECT "workerKind", "lastBeatAt" FROM "V2WorkerHeartbeat"`
    ),
    prisma.$queryRawUnsafe<Array<{ status: string; n: number | bigint }>>(
      `SELECT "status"::text AS "status", COUNT(*)::int AS n
       FROM "V2Job"
       WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED')
       GROUP BY "status"`
    ),
  ]);

  const count = (status: string) =>
    Number(backlogRows.find((r) => r.status === status)?.n ?? 0);

  return shapeWorkerHealth({
    heartbeats,
    backlog: {
      queued: count("QUEUED"),
      running: count("RUNNING"),
      retryScheduled: count("RETRY_SCHEDULED"),
    },
    isProduction: process.env.NODE_ENV === "production",
  });
}
