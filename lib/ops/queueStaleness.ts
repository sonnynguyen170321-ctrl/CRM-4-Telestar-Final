/**
 * Compare what Postgres believes about the queue with what Redis is actually holding.
 *
 * Every surface in this system reports its own step and stops there. The inbox-sync cron reports
 * how many accounts it *asked* for; `enqueue` reports the id it *intended*; the queue reports
 * that it is empty, which is what a healthy queue also looks like. Between 2026-08-26 and
 * 2026-09-16 those three were each telling the truth while no mail was being fetched at all.
 *
 * The two questions below are the ones nothing was asking. Neither needs to know the cause:
 *
 *   - a `JobRun` at `queued` with no live BullMQ job behind it is work that was recorded and
 *     will never happen;
 *   - a job that is supposed to run every few minutes and has not completed in far longer has
 *     stopped, whatever the queue depth says.
 *
 * Pure on purpose: the gathering lives in `scripts/queue-staleness-check.ts`, so the judgement
 * can be tested without Redis, a database, or a clock.
 */

export interface QueuedJobSnapshot {
  id: string;
  jobName: string;
  enqueuedAt: Date;
  /** Whether BullMQ still holds a job that is going to run for this JobRun id. */
  live: boolean;
}

export interface StalenessInput {
  now: Date;
  queued: QueuedJobSnapshot[];
  /** Last `completed` JobRun per job name; `null` when the job has never completed. */
  lastCompleted: Record<string, Date | null>;
}

export interface StalenessPolicy {
  /** How long a `queued` row may lack a live job before it counts as stranded. */
  stuckAfterMs: number;
  /** Per job name, the longest acceptable gap between successful runs. */
  recurrences: Record<string, number>;
}

export type StalenessKind = 'stuck_job' | 'stale_recurrence';

export interface StalenessFinding {
  kind: StalenessKind;
  jobName: string;
  detail: string;
}

const MINUTE_MS = 60_000;

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MINUTE_MS);
}

export function findStaleness(input: StalenessInput, policy: StalenessPolicy): StalenessFinding[] {
  const findings: StalenessFinding[] = [];

  for (const job of input.queued) {
    if (job.live) continue;
    const age = input.now.getTime() - job.enqueuedAt.getTime();
    // A row enqueued moments ago may simply not have been picked up yet; only a persistent
    // absence is evidence.
    if (age < policy.stuckAfterMs) continue;
    findings.push({
      kind: 'stuck_job',
      jobName: job.jobName,
      detail: `JobRun ${job.id} has been queued for ${minutesBetween(job.enqueuedAt, input.now)}m with no live BullMQ job`,
    });
  }

  for (const [jobName, maxGapMs] of Object.entries(policy.recurrences)) {
    const last = input.lastCompleted[jobName] ?? null;
    if (last === null) {
      findings.push({
        kind: 'stale_recurrence',
        jobName,
        detail: `${jobName} has never completed`,
      });
      continue;
    }
    const gap = input.now.getTime() - last.getTime();
    if (gap <= maxGapMs) continue;
    findings.push({
      kind: 'stale_recurrence',
      jobName,
      detail: `${jobName} last completed ${minutesBetween(last, input.now)}m ago, budget ${Math.round(maxGapMs / MINUTE_MS)}m`,
    });
  }

  return findings;
}

/** Human-readable report for a cron log; empty string when everything is healthy. */
export function formatStaleness(findings: StalenessFinding[]): string {
  if (findings.length === 0) return '';
  return findings.map((f) => `[${f.kind}] ${f.detail}`).join('\n');
}
