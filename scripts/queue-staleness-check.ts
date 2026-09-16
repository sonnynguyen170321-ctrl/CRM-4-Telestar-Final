/**
 * Ask Postgres and Redis the same question and compare the answers.
 *
 *     docker exec crm-worker-1 node node_modules/tsx/dist/cli.mjs scripts/queue-staleness-check.ts
 *
 * Exit 0 when healthy, 1 when not — so `|| notify` in cron does the right thing, the same shape
 * as `deploy/hostinger/backup-freshness-check.sh`.
 *
 * This exists because between 2026-08-26 and 2026-09-16 inbox sync fetched nothing and every
 * indicator stayed green: the cron logged the accounts it asked for, the queue was empty, and the
 * `JobRun` rows read `queued`. Each was accurate. Nothing compared them. `worker-healthcheck.ts`
 * proves a worker drains *a job it enqueues itself*, which stayed true throughout — so it could
 * never have caught this, and in any case it was being run on the host, outside the image that
 * holds the Prisma client, and had errored every five minutes since it was installed.
 *
 * The judgement lives in `lib/ops/queueStaleness.ts` and is unit-tested; this file only gathers.
 */
import { createAdminClient } from '@/lib/db/adminClient.mjs';
import { findStaleness, formatStaleness, type StalenessPolicy } from '@/lib/ops/queueStaleness';
import {
  agentQueue,
  closeAllQueues,
  emailQueue,
  importQueue,
  maintenanceQueue,
  sequenceQueue,
  syncQueue,
} from '@/lib/bullmq/queues';
import { QUEUES, jobQueue, type JobType } from '@/lib/bullmq/types';

/**
 * A `queued` row younger than this may simply be waiting its turn. Ten minutes is far longer than
 * any queue wait observed on this host and far shorter than the day a stranded job used to sit.
 */
const STUCK_AFTER_MS = 10 * 60_000;

/**
 * Budgets for the jobs a schedule is supposed to keep running. Each is several times its cron
 * interval, so one slow cycle is not an alert but a stopped one is.
 */
const RECURRENCE_BUDGETS_MS: Record<string, number> = {
  // cron: every 2 minutes
  'email.sync': 15 * 60_000,
  // cron: daily at 03:30
  'maintenance.repair': 26 * 60 * 60_000,
};

const POLICY: StalenessPolicy = {
  stuckAfterMs: STUCK_AFTER_MS,
  recurrences: RECURRENCE_BUDGETS_MS,
};

/** The queue a stored `jobName` belongs to, using the same mapping the producers use. */
function queueForJobName(jobName: string) {
  switch (jobQueue(jobName as JobType)) {
    case QUEUES.SEQUENCE: return sequenceQueue();
    case QUEUES.EMAIL: return emailQueue();
    case QUEUES.IMPORT: return importQueue();
    case QUEUES.SYNC: return syncQueue();
    case QUEUES.AGENT: return agentQueue();
    default: return maintenanceQueue();
  }
}

async function main(): Promise<number> {
  // The admin client, like `worker-healthcheck.ts`: this reads JobRun rows across every tenant,
  // which is exactly what the request-path client is built to refuse.
  const prisma = createAdminClient();
  try {
    const now = new Date();

    const queuedRows = await prisma.jobRun.findMany({
      where: { status: 'queued' },
      select: { id: true, jobName: true, enqueuedAt: true },
      orderBy: { enqueuedAt: 'asc' },
      take: 200,
    });

    // "Live" means BullMQ still holds a job that is going to run. A job that has settled, or whose
    // hash is in no list at all, is not going to run again by itself.
    const queued = await Promise.all(
      queuedRows.map(async (row) => {
        const job = await queueForJobName(row.jobName).getJob(row.id);
        if (!job) return { ...row, live: false };
        const state = await job.getState();
        const live = state !== 'completed' && state !== 'failed' && state !== 'unknown';
        return { ...row, live };
      })
    );

    const lastCompleted: Record<string, Date | null> = {};
    for (const jobName of Object.keys(RECURRENCE_BUDGETS_MS)) {
      const row = await prisma.jobRun.findFirst({
        where: { jobName, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      lastCompleted[jobName] = row?.completedAt ?? null;
    }

    const findings = findStaleness({ now, queued, lastCompleted }, POLICY);
    if (findings.length === 0) {
      console.log(`ok: ${queued.length} queued row(s), every recurrence inside its budget`);
      return 0;
    }
    console.error(formatStaleness(findings));
    return 1;
  } finally {
    await closeAllQueues().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // A check that cannot run is not a healthy system; say so with the reason and fail.
    console.error(`queue-staleness-check failed to run: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
