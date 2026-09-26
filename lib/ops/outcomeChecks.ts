/**
 * Checks that ask what the system *did*, not what it is configured to do.
 *
 * Three production incidents in one week shared a shape. In each, a mechanism was configured,
 * believed to be working, and doing nothing — and nothing compared the belief to the result:
 *
 *   - WAL archiving: `archive_mode=on` with a repo that never existed. 54,283 failures, 0
 *     successes, 179 GB of unreclaimable WAL, and a 200 GB disk at 100%. The notes said
 *     "archiving LIVE since 2026-09-16"; it had never archived one segment.
 *   - Bounce suppression: a suppression gate ran in front of every send and the list held 0
 *     rows for a month, because the only thing that could fill it could not parse an address.
 *   - Cadence repair: `npm run backfill:next-action` printed `Total Evaluated: 0 / Done.` while
 *     278 enrollments needed repair. It had not repaired nothing; it had read nothing.
 *
 * A config check would have passed all three. What catches them is asking for the *effect* —
 * is the counter climbing, did the list grow when a bounce arrived, did any cadence advance —
 * and treating "zero of everything" as a question rather than an answer.
 *
 * Pure on purpose: `scripts/outcome-check.ts` gathers the numbers, this decides what they mean,
 * and `tests/outcome-checks.test.ts` pins the judgements without needing a database.
 */

export type Level = 'ok' | 'warn' | 'fail';

export interface Finding {
  readonly check: string;
  readonly level: Level;
  /** What was measured, in the operator's terms. */
  readonly detail: string;
}

/** Below this, the disk needs attention before it needs a plan. */
const DISK_WARN_PERCENT = 75;
const DISK_FAIL_PERCENT = 90;

/** WAL far larger than the data it protects means it is not being reclaimed. */
const WAL_TO_DATA_RATIO_FAIL = 10;

export interface DiskFacts {
  usedPercent: number;
  walBytes: number;
  dataBytes: number;
}

export function checkDisk(f: DiskFacts): Finding[] {
  const out: Finding[] = [];

  out.push({
    check: 'disk',
    level:
      f.usedPercent >= DISK_FAIL_PERCENT ? 'fail' : f.usedPercent >= DISK_WARN_PERCENT ? 'warn' : 'ok',
    detail: `${f.usedPercent}% used`,
  });

  // The ratio, not the absolute size. 179 GB of WAL is only obviously wrong once you know the
  // database is 115 MB — which is exactly the comparison nobody made.
  const ratio = f.dataBytes > 0 ? f.walBytes / f.dataBytes : 0;
  if (ratio >= WAL_TO_DATA_RATIO_FAIL) {
    out.push({
      check: 'wal-size',
      level: 'fail',
      detail:
        `pg_wal is ${gb(f.walBytes)} against ${gb(f.dataBytes)} of data (${Math.round(ratio)}×) — ` +
        `WAL is not being reclaimed, usually a failing archive_command`,
    });
  } else {
    out.push({ check: 'wal-size', level: 'ok', detail: `pg_wal ${gb(f.walBytes)}` });
  }

  return out;
}

export interface ArchiverFacts {
  archiveMode: string;
  archiveCommand: string;
  archivedCount: number;
  failedCount: number;
}

/**
 * Archiving is either off, or working. "On and failing" is the state that fills a disk, and it
 * is the state that looks healthiest in a config file.
 */
export function checkArchiver(f: ArchiverFacts): Finding {
  const disabled = f.archiveMode !== 'on' || /^\/bin\/true\s*$/.test(f.archiveCommand);
  if (disabled) {
    return {
      check: 'wal-archiving',
      level: 'ok',
      detail: 'off — the nightly dump is the only backup, by choice',
    };
  }

  if (f.archivedCount === 0) {
    return {
      check: 'wal-archiving',
      level: 'fail',
      detail:
        `enabled but has never archived a segment (${f.failedCount} failures). ` +
        `There is no point-in-time recovery, and pg_wal will grow until the disk is full.`,
    };
  }

  if (f.failedCount > f.archivedCount) {
    return {
      check: 'wal-archiving',
      level: 'warn',
      detail: `${f.archivedCount} archived, ${f.failedCount} failed — failing more often than not`,
    };
  }

  return { check: 'wal-archiving', level: 'ok', detail: `${f.archivedCount} segments archived` };
}

export interface SuppressionFacts {
  bouncesRecorded: number;
  suppressionEntries: number;
}

/**
 * A bounce that suppresses nobody is a bounce the next campaign will repeat.
 *
 * Compared as a ratio, not against zero. The first version of this check only failed on an
 * empty list, and on its first production run it reported `ok` for **1 suppressed against 51
 * bounces** — the exact shape of the defect it exists to catch, passed by the check written to
 * catch it. One address is not "the list is working"; it is a list that happens to be non-empty.
 *
 * Addresses repeat across bounces, so the ratio is loose on purpose: the concern is an order of
 * magnitude, not an exact accounting.
 */
const SUPPRESSION_PER_BOUNCE_FAIL = 0.25;

export function checkSuppression(f: SuppressionFacts): Finding {
  if (f.bouncesRecorded === 0) {
    return { check: 'bounce-suppression', level: 'ok', detail: 'no bounces on record' };
  }

  const ratio = f.suppressionEntries / f.bouncesRecorded;
  if (ratio < SUPPRESSION_PER_BOUNCE_FAIL) {
    return {
      check: 'bounce-suppression',
      level: 'fail',
      detail:
        `${f.bouncesRecorded} bounce(s) recorded but only ${f.suppressionEntries} address(es) ` +
        `suppressed — those mailboxes are still in the sending pool and will be written to again`,
    };
  }

  return {
    check: 'bounce-suppression',
    level: 'ok',
    detail: `${f.suppressionEntries} suppressed, ${f.bouncesRecorded} bounce(s) on record`,
  };
}

export interface CadenceFacts {
  activeEnrollments: number;
  /** Active but with no scheduled next action — invisible to the drift repair. */
  withoutNextAction: number;
  /**
   * Cadence steps that actually closed in the last day, counted from `Task.completedAt`.
   *
   * Deliberately not `SequenceEnrollment.lastTransitionAt`: on its first production run this
   * check read that field and saw four-day-old data while 28 steps had advanced in 24 hours,
   * because the advance path wrote `currentStep` and forgot the timestamp. A completed task is
   * the effect itself, so it cannot drift from the thing being measured.
   */
  stepsCompletedLastDay: number;
  sentLastDay: number;
}

export function checkCadence(f: CadenceFacts): Finding[] {
  const out: Finding[] = [];

  if (f.withoutNextAction > 0) {
    out.push({
      check: 'cadence-schedule',
      level: 'warn',
      detail:
        `${f.withoutNextAction} of ${f.activeEnrollments} active enrollments have no next action — ` +
        `they are invisible to the drift repair and will never move on their own`,
    });
  } else {
    out.push({ check: 'cadence-schedule', level: 'ok', detail: 'every active enrollment is scheduled' });
  }

  // Silence is the symptom that has no error attached to it, so it has to be asked about
  // directly: a cadence engine that stopped looks exactly like a quiet day.
  if (f.activeEnrollments > 0 && f.stepsCompletedLastDay === 0 && f.sentLastDay === 0) {
    out.push({
      check: 'cadence-motion',
      level: 'fail',
      detail: `${f.activeEnrollments} active cadences and nothing sent or advanced in 24h`,
    });
  } else {
    out.push({
      check: 'cadence-motion',
      level: 'ok',
      detail: `${f.sentLastDay} sent, ${f.stepsCompletedLastDay} step(s) completed in 24h`,
    });
  }

  return out;
}

export interface CapacityFacts {
  /** Steps waiting to go out. */
  queued: number;
  /** Sum of the daily caps of every mailbox that is actually sending. */
  dailyCapacityInUse: number;
}

/**
 * How many days of backlog the sending mailboxes are carrying.
 *
 * The operator chose to keep one mailbox sending, so a queue is expected. What is not expected
 * is a queue that outruns it — a message deferred day after day is one nobody is looking at.
 */
export function checkCapacity(f: CapacityFacts): Finding {
  if (f.dailyCapacityInUse <= 0) {
    return f.queued > 0
      ? { check: 'send-capacity', level: 'fail', detail: `${f.queued} queued and no mailbox is sending` }
      : { check: 'send-capacity', level: 'ok', detail: 'nothing queued' };
  }

  const days = f.queued / f.dailyCapacityInUse;
  return {
    check: 'send-capacity',
    level: days >= 5 ? 'warn' : 'ok',
    detail: `${f.queued} queued against ${f.dailyCapacityInUse}/day — ${days.toFixed(1)} days of backlog`,
  };
}

/** The worst level present, which is what decides the exit code. */
export function overall(findings: Finding[]): Level {
  if (findings.some((f) => f.level === 'fail')) return 'fail';
  if (findings.some((f) => f.level === 'warn')) return 'warn';
  return 'ok';
}

function gb(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
