import "server-only";

import { after } from "next/server";

import { processNextV2Job } from "./processJob";
import { queryWorkerHealth } from "./queryWorkerHealth";
import type { V2JobDatabase, V2JobSourceType, V2JobType } from "./types";

// Track R de-inline (worker-aware). The enqueue-then-act surfaces used to ALWAYS drain a
// bounded number of jobs inline so the user saw results without an always-on worker
// (blindspot #1: the pilot must run with zero Redis). That blocks the request for seconds
// (up to ~16s for a live enrichment). This keeps the zero-worker fallback but SKIPS the
// blocking drain when a live job worker will pick the job up — premium async when a worker
// runs, pilot-safe inline fallback when not. Net strictly >= the old behavior.

/** Pure: drain inline only when no live job worker will process the enqueued job. */
export function shouldDrainInline(jobWorkerHealthy: boolean): boolean {
  return !jobWorkerHealthy;
}

export async function drainIfNoWorker(
  db: V2JobDatabase,
  input: { organizationId: string; jobType: V2JobType; max: number; sourceType?: V2JobSourceType; sourceId?: string | null }
): Promise<{ mode: "worker" | "inline"; drained: number }> {
  const health = await queryWorkerHealth();
  const jobWorker = health.workers.find((worker) => worker.kind === "job_worker");
  if (!shouldDrainInline(Boolean(jobWorker?.healthy))) {
    return { mode: "worker", drained: 0 };
  }
  let drained = 0;
  for (let i = 0; i < input.max; i++) {
    const result = await processNextV2Job(db, {
      organizationId: input.organizationId,
      jobType: input.jobType,
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    });
    if (!result || result.kind === "no_job") break;
    drained++;
  }
  return { mode: "inline", drained };
}

/**
 * Off-request drain (Deep D2). Schedules the zero-worker inline drain to run AFTER the response has
 * flushed via Next's `after()`, so the caller returns immediately instead of blocking the request for
 * seconds while jobs process. Use this when the response payload does NOT depend on the drained result
 * and a watcher/progress loop reflects completion (e.g. lead enroll, ICP score) — the GlobalJobWatcher
 * toasts on finish. In worker mode `drainIfNoWorker` is already a no-op, so this stays net-safe.
 *
 * Invariant 10 is preserved: suppression still runs synchronously inside each EMAIL_SEND the drain
 * processes; it is only moved off the user's request thread, never skipped.
 */
export function drainAfterResponse(
  db: V2JobDatabase,
  input: { organizationId: string; jobType: V2JobType; max: number; sourceType?: V2JobSourceType; sourceId?: string | null }
): void {
  after(async () => {
    try {
      await drainIfNoWorker(db, input);
    } catch (err) {
      console.error("[drainAfterResponse] drain failed", err);
    }
  });
}
