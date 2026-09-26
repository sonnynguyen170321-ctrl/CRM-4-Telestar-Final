/**
 * Ask the production system what it actually did, once a day.
 *
 * Not a config check — a config check would have passed on every day of the week that produced
 * it. See `lib/ops/outcomeChecks.ts` for the three incidents this is built from: WAL archiving
 * that never archived, a suppression list that never filled, a repair tool that never read.
 * Each was configured correctly, believed to be working, and doing nothing.
 *
 *   npx tsx scripts/outcome-check.ts
 *
 * Read-only. Exits 0 when everything is fine, 1 on a warning, 2 on a failure — so cron can
 * decide whether the output is worth a human's attention.
 *
 *   30 7 * * *  docker exec crm-worker-1 node node_modules/tsx/dist/cli.mjs \
 *                 scripts/outcome-check.ts >>/var/log/crm-outcome.log 2>&1
 */
import { statfsSync } from 'fs';
import { prisma } from '@/lib/prisma';
import { asOperator } from './lib/tenantContext';
import {
  checkArchiver,
  checkCadence,
  checkCapacity,
  checkDisk,
  checkSuppression,
  overall,
  type Finding,
} from '@/lib/ops/outcomeChecks';

const DAY_AGO = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

/** `pg_settings` and the archiver counters, straight from the running server. */
async function archiverFacts() {
  const [settings, stats] = await Promise.all([
    prisma.$queryRaw<{ name: string; setting: string }[]>`
      SELECT name, setting FROM pg_settings WHERE name IN ('archive_mode', 'archive_command')
    `,
    prisma.$queryRaw<{ archived_count: bigint; failed_count: bigint }[]>`
      SELECT archived_count, failed_count FROM pg_stat_archiver
    `,
  ]);
  const get = (n: string) => settings.find((s) => s.name === n)?.setting ?? '';
  return {
    archiveMode: get('archive_mode'),
    archiveCommand: get('archive_command'),
    archivedCount: Number(stats[0]?.archived_count ?? 0),
    failedCount: Number(stats[0]?.failed_count ?? 0),
  };
}

async function diskFacts() {
  const [wal, data] = await Promise.all([
    prisma.$queryRaw<{ bytes: bigint }[]>`SELECT coalesce(sum(size), 0)::bigint AS bytes FROM pg_ls_waldir()`,
    prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`,
  ]);
  return {
    usedPercent: diskUsedPercent(),
    walBytes: Number(wal[0]?.bytes ?? 0),
    dataBytes: Number(data[0]?.bytes ?? 0),
  };
}

/**
 * How full the filesystem under this container is.
 *
 * `statfs` on `/`: the container's root and the Docker volumes live on the same host device, so
 * this is the number that reached 100% on 2026-09-26. Returns 0 only if the call itself fails,
 * and says so — a disk check that silently reports "0% used" is worse than no disk check,
 * because it reads as healthy forever.
 */
function diskUsedPercent(): number {
  try {
    const s = statfsSync('/');
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    if (total <= 0) return 0;
    return Math.round(((total - free) / total) * 100);
  } catch (err) {
    console.error('  (could not read disk usage:', err, ')');
    return 0;
  }
}

async function tenantFindings(): Promise<Finding[]> {
  const since = DAY_AGO();

  const [bounces, suppressions, activeEnrollments, withoutNextAction, advanced, sent, queued, accounts] =
    await Promise.all([
      prisma.inboundMessage.count({ where: { isBounce: true } }),
      prisma.suppressionEntry.count(),
      prisma.sequenceEnrollment.count({ where: { status: 'active' } }),
      prisma.sequenceEnrollment.count({ where: { status: 'active', nextActionAt: null } }),
      prisma.sequenceEnrollment.count({ where: { lastTransitionAt: { gte: since } } }),
      prisma.outboundMessage.count({ where: { status: 'sent', sentAt: { gte: since } } }),
      prisma.outboundMessage.count({ where: { status: { in: ['pending', 'failed'] }, sentAt: null } }),
      prisma.emailAccount.findMany({
        where: { isActive: true, sendPausedAt: null },
        select: { dailyCap: true, dailySendCount: true },
      }),
    ]);

  // Capacity that is actually being used, not capacity that exists: a mailbox nobody's leads
  // are assigned to contributes nothing to clearing a backlog, however large its cap.
  const dailyCapacityInUse = accounts
    .filter((a) => a.dailySendCount > 0)
    .reduce((sum, a) => sum + a.dailyCap, 0);

  return [
    checkSuppression({ bouncesRecorded: bounces, suppressionEntries: suppressions }),
    ...checkCadence({
      activeEnrollments,
      withoutNextAction,
      advancedLastDay: advanced,
      sentLastDay: sent,
    }),
    checkCapacity({ queued, dailyCapacityInUse }),
  ];
}

async function main() {
  const findings = await asOperator(async () => [
    ...checkDisk(await diskFacts()),
    checkArchiver(await archiverFacts()),
    ...(await tenantFindings()),
  ]);

  const worst = overall(findings);
  const icon = { ok: 'ok  ', warn: 'WARN', fail: 'FAIL' } as const;

  console.log(`Outcome check — ${new Date().toISOString()}`);
  for (const f of findings) {
    console.log(`  [${icon[f.level]}] ${f.check.padEnd(20)} ${f.detail}`);
  }

  if (worst === 'ok') {
    console.log('\nEverything the system claims to be doing, it is doing.');
  } else {
    console.log(
      `\n${worst === 'fail' ? 'Something is not working' : 'Something needs a decision'} — the lines above say which.`
    );
  }

  process.exitCode = worst === 'fail' ? 2 : worst === 'warn' ? 1 : 0;
}

main()
  .catch((err) => {
    console.error('outcome-check could not run:', err);
    // Loudly. A health check that fails to run must not be mistaken for one that passed — that
    // confusion is the whole reason this file exists.
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
