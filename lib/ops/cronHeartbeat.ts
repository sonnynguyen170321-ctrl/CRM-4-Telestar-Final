import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

/**
 * Leave a trace that a cron actually ran.
 *
 * `scripts/queue-staleness-check.ts` can already say "no job of this name has completed for longer
 * than its budget" — but only for names that appear in `JobRun`. Two of the four scheduled crons,
 * `sequence-engine` and `email-health`, do their work inline and enqueue nothing, so they leave no
 * row, so no budget could be written for them and a stopped cron was undetectable. Nothing in the
 * system noticed; the only evidence was an absence in a log file.
 *
 * `JobRun` is the right table rather than a new one: it is already the durable record of "something
 * that was supposed to happen, happened", and it is already what the staleness checker reads. These
 * rows are also cheap now that `JobRun` is on the audit extension's skip list — before that, each
 * heartbeat would have cost an extra read and an extra insert of its own.
 *
 * Never throws. A heartbeat that can fail the cron it is recording would be worse than no heartbeat.
 */
export async function recordCronHeartbeat(cronName: string, tenantId: string): Promise<void> {
  const jobName = `cron.${cronName}`;
  const now = new Date();
  try {
    await tenantStorage.run({ tenantId, bypassRls: true }, () =>
      prisma.jobRun.create({
        data: {
          tenantId,
          queueName: 'cron',
          jobName,
          // One row per run, and the minute makes it unique. Two ticks inside the same minute
          // converge on one row rather than erroring on the unique constraint — the question being
          // answered is "when did this last run", which a second row in the same minute cannot
          // change.
          dedupeKey: `${jobName}:${now.toISOString().slice(0, 16)}`,
          status: 'completed',
          enqueuedAt: now,
          startedAt: now,
          completedAt: now,
          maxAttempts: 1,
        },
      })
    );
  } catch (err) {
    // A duplicate inside the same minute is the expected benign case and needs no noise.
    const code = (err as { code?: string })?.code;
    if (code === 'P2002') return;
    console.error(`[cronHeartbeat] could not record ${jobName}:`, err);
  }
}
