/**
 * Queue observability.
 *
 * `getJobCounts()` tells you how many jobs are waiting. It does not tell you whether
 * anything is *draining* them — a queue with 4 waiting jobs looks identical whether a
 * worker picked one up a second ago or died three hours ago. The two additions here are
 * the ones that distinguish those cases:
 *
 *   oldestWaitingAgeMs   how long the front of the queue has been sitting there
 *   heartbeat            when a worker last completed anything at all
 *
 * Depth alerts on their own are noisy during a burst and silent during an outage. Age and
 * heartbeat are the signals worth paging on.
 */

import type { Queue } from 'bullmq';
import { prisma } from '@/lib/prisma';

export type QueueMetrics = {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  /** Age of the oldest waiting job, or null when the queue is empty. */
  oldestWaitingAgeMs: number | null;
  error?: string;
};

export type WorkerHeartbeat = {
  /** When a worker last moved any job to a terminal state. */
  lastSeenAt: string | null;
  ageMs: number | null;
  /** False when nothing has completed within the staleness window. */
  healthy: boolean;
};

/**
 * How long without a completed job before workers are considered stale.
 *
 * The maintenance healthcheck is enqueued far more often than this, so silence for this
 * long means the consumer side is down rather than merely idle.
 */
export const HEARTBEAT_STALE_MS = 15 * 60_000;

/** Queue depth alone is not a fault. These are the thresholds worth reacting to. */
export const QUEUE_ALERT = {
  /** A job that has waited this long is not "busy", it is stuck. */
  oldestWaitingMs: 10 * 60_000,
  /** Failures accumulate silently; BullMQ keeps them out of the way by design. */
  failed: 25,
} as const;

/**
 * Collect metrics for one queue.
 *
 * Never throws: an observability call that fails the request it is reporting on is worse
 * than one that reports a gap. The error is returned as data instead.
 */
export async function collectQueueMetrics(name: string, queue: Queue): Promise<QueueMetrics> {
  const empty: QueueMetrics = {
    name,
    waiting: 0,
    active: 0,
    delayed: 0,
    failed: 0,
    completed: 0,
    oldestWaitingAgeMs: null,
  };

  try {
    const counts = await queue.getJobCounts();

    // Only the front of the waiting list matters; fetching the whole list to sort it
    // would make the health endpoint proportional to the size of the backlog.
    let oldestWaitingAgeMs: number | null = null;
    const [oldest] = await queue.getWaiting(0, 0);
    if (oldest?.timestamp) {
      oldestWaitingAgeMs = Math.max(0, Date.now() - oldest.timestamp);
    }

    return {
      name,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
      oldestWaitingAgeMs,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * When did a worker last finish anything?
 *
 * Read from `JobRun` in Postgres rather than from Redis on purpose. If Redis is the thing
 * that is broken, a heartbeat stored in Redis is unreadable exactly when it is needed —
 * and the runtime law for this system is that the database holds the truth and BullMQ can
 * be rebuilt from it.
 */
export async function getWorkerHeartbeat(): Promise<WorkerHeartbeat> {
  try {
    const last = await prisma.jobRun.findFirst({
      where: { status: { in: ['completed', 'failed'] }, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });

    if (!last?.completedAt) {
      return { lastSeenAt: null, ageMs: null, healthy: false };
    }

    const ageMs = Date.now() - last.completedAt.getTime();
    return {
      lastSeenAt: last.completedAt.toISOString(),
      ageMs,
      healthy: ageMs < HEARTBEAT_STALE_MS,
    };
  } catch {
    return { lastSeenAt: null, ageMs: null, healthy: false };
  }
}

/**
 * Turn metrics into the specific problems worth acting on.
 *
 * Pure, so the thresholds can be tested without a queue.
 */
export function summarizeAlerts(
  queues: QueueMetrics[],
  heartbeat: WorkerHeartbeat
): string[] {
  const alerts: string[] = [];

  if (!heartbeat.healthy) {
    alerts.push(
      heartbeat.lastSeenAt
        ? `No job has completed for ${Math.round((heartbeat.ageMs ?? 0) / 60_000)}m — workers may be down.`
        : 'No job has ever completed — workers may never have started.'
    );
  }

  for (const q of queues) {
    if (q.error) {
      alerts.push(`Queue "${q.name}" could not be read: ${q.error}`);
      continue;
    }
    if (q.oldestWaitingAgeMs !== null && q.oldestWaitingAgeMs > QUEUE_ALERT.oldestWaitingMs) {
      // Depth would not catch this: one job stuck for an hour is a smaller number than a
      // healthy burst, and a far worse condition.
      alerts.push(
        `Queue "${q.name}" has a job waiting ${Math.round(q.oldestWaitingAgeMs / 60_000)}m — nothing is draining it.`
      );
    }
    if (q.failed >= QUEUE_ALERT.failed) {
      alerts.push(`Queue "${q.name}" has ${q.failed} failed jobs.`);
    }
  }

  return alerts;
}
