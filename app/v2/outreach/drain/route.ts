import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { processNextV2Job } from "@/lib/v2/jobs/processJob";
import { reclaimStaleV2Jobs } from "@/lib/v2/jobs/claimNextJob";
import { tickDueEnrollments } from "@/lib/v2/outreach/sequences/tickDueEnrollments";
import { recordWorkerHeartbeat } from "@/lib/v2/outreach/worker/heartbeat";
import type { V2JobDatabase, V2JobType } from "@/lib/v2/jobs/types";

// O5s (Link D / B11): the background worker's drain target. Outreach jobs
// (EMAIL_SEND, SEQUENCE_STEP_EXECUTE) are not ingestion-scoped and have no UI run
// control, so without this they would silently stall (§4d). A cron / the
// v2-job-worker script POSTs here on an interval with the worker secret; it drains
// due outreach jobs system-wide (each job carries its own org for processJob).
// Secret-gated (no user session) — never expose without V2_WORKER_SECRET set.

const JOB_TYPES_TO_DRAIN: V2JobType[] = [
  "EMAIL_SEND",
  "SEQUENCE_STEP_EXECUTE",
  "ICP_SCORE",
  "RESEARCH_DISCOVERY",
  "RESEARCH_ENRICH",
  "COMPANY_ENRICHMENT",
  "EXPORT_GENERATE",
  "ACTIVITY_APPLY"
];

export async function POST(request: NextRequest) {
  const expected = process.env.V2_WORKER_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Worker drain disabled (V2_WORKER_SECRET not set)." }, { status: 503 });
  }
  const provided = request.headers.get("x-v2-worker-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Proof of life: the worker hitting this route on its interval keeps the
  // job-worker heartbeat fresh (launch readiness checks it in production).
  await recordWorkerHeartbeat("job_worker");

  const db = prisma as unknown as V2JobDatabase;
  const MAX_LOOP = 100;
  const TIME_LIMIT_MS = 25_000;
  const startTime = Date.now();
  let processed = 0;
  let stoppedReason: "idle" | "max_reached" | "timeout_approaching" = "idle";
  const summary: Record<string, { succeeded: number; failed: number; retry_scheduled: number }> = {};

  // Reaper: requeue jobs left RUNNING by a worker that died mid-flight (stale
  // threshold), across ALL job types — otherwise a crashed enrichment/scoring job
  // sits RUNNING forever and never re-executes. Retryable ones go RETRY_SCHEDULED;
  // exhausted ones FAIL with STALE_RUNNING_JOB.
  const reaped = await reclaimStaleV2Jobs(db, {});

  // Advance due sequence enrollments first: each due enrollment gets a
  // SEQUENCE_STEP_EXECUTE queued, which the loop below then drains. This is the
  // scheduler — without it, published sequences never progress past enrollment.
  const tick = await tickDueEnrollments(db);

  drain: for (const jobType of JOB_TYPES_TO_DRAIN) {
    for (;;) {
      if (processed >= MAX_LOOP) {
        stoppedReason = "max_reached";
        break drain;
      }
      if (Date.now() - startTime > TIME_LIMIT_MS) {
        stoppedReason = "timeout_approaching";
        break drain;
      }
      const result = await processNextV2Job(db, { jobType });
      if (!result || result.kind === "no_job") {
        break; // this job type is idle; next type
      }
      processed++;
      const type = result.job.jobType;
      summary[type] ??= { succeeded: 0, failed: 0, retry_scheduled: 0 };
      if (result.kind === "succeeded") summary[type].succeeded++;
      if (result.kind === "failed") summary[type].failed++;
      if (result.kind === "retry_scheduled") summary[type].retry_scheduled++;
    }
  }

  return NextResponse.json({ ok: true, processed, stoppedReason, summary, scheduler: tick, reaped });
}
