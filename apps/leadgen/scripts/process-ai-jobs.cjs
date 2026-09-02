/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_APP_URL = "http://127.0.0.1:3000";

let stopping = false;

loadEnvFiles([".env.local", ".env", ".env.production"]);

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const filePath = path.join(process.cwd(), fileName);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function readArg(name) {
  const flag = `--${name}`;
  const prefix = `${flag}=`;

  if (process.argv.includes(flag)) {
    return "true";
  }

  const match = process.argv.find((arg) => arg.startsWith(prefix));

  return match ? match.slice(prefix.length).trim() : "";
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function processOnce({ appUrl, secret, uploadJobId }) {
  const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/ai-jobs/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ai-job-secret": secret,
    },
    body: JSON.stringify(uploadJobId ? { uploadJobId } : {}),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `AI worker request failed with status ${response.status}.`
    );
  }

  return body.data ?? body;
}

async function main() {
  const secret = process.env.AI_JOB_PROCESS_SECRET?.trim();

  if (!secret) {
    throw new Error("AI_JOB_PROCESS_SECRET is required for the AI worker.");
  }

  const appUrl =
    process.env.AI_WORKER_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    DEFAULT_APP_URL;
  const uploadJobId = readArg("uploadJobId") || undefined;
  const once = readArg("once") === "true";
  const pollMs = readPositiveInt(
    process.env.AI_WORKER_POLL_MS || process.env.AI_REQUEST_DELAY_MS,
    9000
  );

  console.log(
    JSON.stringify({
      event: "ai_worker_started",
      appUrl,
      uploadJobId: uploadJobId ?? "global",
      pollMs,
      once,
    })
  );

  while (!stopping) {
    const cycleStartedAt = new Date().toISOString();

    try {
      const result = await processOnce({ appUrl, secret, uploadJobId });
      console.log(
        JSON.stringify({
          event: "ai_worker_cycle",
          cycleStartedAt,
          uploadJobId: result.uploadJobId ?? uploadJobId ?? "global",
          processed: result.processed ?? 0,
          succeeded: result.succeeded ?? 0,
          failed: result.failed ?? 0,
          retryScheduled: result.retryScheduled ?? 0,
          retryScheduledMeaning: "recoverable_when_due",
          cacheHits: result.cacheHits ?? 0,
          skipped: result.skipped ?? false,
          skippedJobs: result.skippedJobs ?? 0,
          staleReclaimed: result.staleReclaimed ?? 0,
          skippedReason: result.skippedReason ?? result.reason ?? null,
          quotaPaused: result.quotaPaused ?? false,
          stoppedReason: result.stoppedReason ?? null,
          nextRetryAt: result.nextRetryAt ?? result.nextAttemptAt ?? null,
          total: result.total ?? null,
          pending: result.pending ?? null,
          running: result.running ?? null,
          succeededTotal: result.succeededTotal ?? null,
          failedTotal: result.failedTotal ?? null,
          failedMeaning: "terminal_until_manual_requeue",
          retryScheduledTotal: result.retryScheduledTotal ?? null,
          progressPercent: result.progressPercent ?? null,
          nextAttemptAt: result.nextAttemptAt ?? null,
          lastErrorCode: result.lastErrorCode ?? null,
          lastErrorMessage: result.lastErrorMessage ?? null,
        })
      );

      if (
        result.quotaPaused ||
        result.stoppedReason === "daily_request_budget_reached" ||
        result.stoppedReason === "quota_or_rate_limited"
      ) {
        console.log(
          JSON.stringify({
            event: "ai_worker_paused",
            uploadJobId: result.uploadJobId ?? uploadJobId ?? "global",
            reason: result.stoppedReason ?? "quota_or_rate_limited",
            message:
              "Worker stopped because AI is paused. retry_scheduled jobs remain recoverable when due; failed jobs require manual requeue.",
          })
        );
        break;
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "ai_worker_request_failed",
          uploadJobId: uploadJobId ?? "global",
          message: error instanceof Error ? error.message : "Worker cycle failed.",
        })
      );
    }

    if (once) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  console.log(JSON.stringify({ event: "ai_worker_stopped" }));
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "ai_worker_fatal",
      message: error instanceof Error ? error.message : "AI worker failed.",
    })
  );
  process.exitCode = 1;
});
