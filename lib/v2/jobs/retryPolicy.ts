import type { V2JobRecord } from "./types";

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

const BACKOFF_MS_BY_ATTEMPT_STARTED = [30_000, 120_000, 600_000];

export function shouldRetryJob(
  job: Pick<V2JobRecord, "retryCount">,
  retryable: boolean,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
) {
  // retryCount means attemptsStarted in JOB0. It increments at claim time so a
  // worker crash after claim still consumes an attempt and cannot loop forever.
  return retryable && job.retryCount < maxAttempts;
}

export function buildNextAttemptAt(
  attemptsStarted: number,
  now = new Date(),
  options: { jitter?: boolean } = {}
) {
  const backoffMs =
    BACKOFF_MS_BY_ATTEMPT_STARTED[
      Math.min(Math.max(attemptsStarted - 1, 0), BACKOFF_MS_BY_ATTEMPT_STARTED.length - 1)
    ];
  const jitterMs = options.jitter === false ? 0 : Math.floor(Math.random() * 1000);

  return new Date(now.getTime() + backoffMs + jitterMs);
}
