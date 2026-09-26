import { describe, it, expect } from 'vitest';
import {
  checkArchiver,
  checkCadence,
  checkCapacity,
  checkDisk,
  checkSuppression,
  overall,
} from '@/lib/ops/outcomeChecks';

/**
 * Each case is a production state that actually happened and that nothing reported at the time.
 * A check is only worth having if it would have fired then, so every one is written against the
 * real numbers rather than against a plausible-looking fixture.
 */

describe('WAL archiving', () => {
  it('fails on the 2026-09-26 state: enabled, 54,283 failures, never archived once', () => {
    const f = checkArchiver({
      archiveMode: 'on',
      archiveCommand: 'pgbackrest --stanza=crm archive-push %p',
      archivedCount: 0,
      failedCount: 54283,
    });

    expect(f.level).toBe('fail');
    expect(f.detail).toContain('never archived');
  });

  it('is content when archiving is deliberately off', () => {
    // The state after the rescue: no PITR, by decision, with the nightly dump as the backup.
    // Not a problem to report every day.
    expect(
      checkArchiver({ archiveMode: 'on', archiveCommand: '/bin/true', archivedCount: 0, failedCount: 0 })
        .level
    ).toBe('ok');
    expect(
      checkArchiver({ archiveMode: 'off', archiveCommand: '', archivedCount: 0, failedCount: 0 }).level
    ).toBe('ok');
  });

  it('warns when archiving works but fails more often than it succeeds', () => {
    const f = checkArchiver({
      archiveMode: 'on',
      archiveCommand: 'pgbackrest --stanza=crm archive-push %p',
      archivedCount: 100,
      failedCount: 900,
    });
    expect(f.level).toBe('warn');
  });
});

describe('disk and WAL size', () => {
  it('fails on 179 GB of WAL against a 115 MB database', () => {
    const findings = checkDisk({
      usedPercent: 100,
      walBytes: 179 * 1024 ** 3,
      dataBytes: 115 * 1024 ** 2,
    });

    expect(findings.find((f) => f.check === 'disk')?.level).toBe('fail');
    const wal = findings.find((f) => f.check === 'wal-size');
    expect(wal?.level).toBe('fail');
    // The ratio is the thing: 179 GB is only obviously wrong next to the size of what it protects.
    expect(wal?.detail).toContain('not being reclaimed');
  });

  it('is content with the state after the rescue', () => {
    const findings = checkDisk({ usedPercent: 7, walBytes: 96 * 1024 ** 2, dataBytes: 115 * 1024 ** 2 });
    expect(findings.every((f) => f.level === 'ok')).toBe(true);
  });

  it('warns before the disk is an emergency rather than at 100%', () => {
    expect(
      checkDisk({ usedPercent: 80, walBytes: 1024 ** 3, dataBytes: 1024 ** 3 }).find(
        (f) => f.check === 'disk'
      )?.level
    ).toBe('warn');
  });
});

describe('bounce suppression', () => {
  it('fails on a month of bounces with an empty suppression list', () => {
    // Production, 2026-09-23: 42 hard bounces stored, 0 suppression entries, and every one of
    // those mailboxes still being written to.
    const f = checkSuppression({ bouncesRecorded: 42, suppressionEntries: 0 });
    expect(f.level).toBe('fail');
    expect(f.detail).toContain('still in the sending pool');
  });

  it('fails on 1 suppressed against 51 bounces', () => {
    // The first version of this check only failed on an empty list, and on its first
    // production run it reported `ok` for exactly this — the defect it exists to catch,
    // waved through by the check written to catch it. One address is not a working list.
    const f = checkSuppression({ bouncesRecorded: 51, suppressionEntries: 1 });
    expect(f.level).toBe('fail');
  });

  it('accepts fewer entries than bounces, because addresses repeat', () => {
    expect(checkSuppression({ bouncesRecorded: 51, suppressionEntries: 30 }).level).toBe('ok');
  });

  it('says nothing when there have been no bounces to act on', () => {
    expect(checkSuppression({ bouncesRecorded: 0, suppressionEntries: 0 }).level).toBe('ok');
  });
});

describe('cadence', () => {
  it('warns about enrollments no repair sweep can see', () => {
    // 278 of them on production, active with a null nextActionAt, invisible to the drift repair
    // because it queries `nextActionAt < now()`.
    const findings = checkCadence({
      activeEnrollments: 1105,
      withoutNextAction: 278,
      stepsCompletedLastDay: 12,
      sentLastDay: 80,
    });
    expect(findings.find((f) => f.check === 'cadence-schedule')?.level).toBe('warn');
  });

  it('fails when cadences exist and nothing moved for a day', () => {
    // A stopped engine and a quiet day look identical unless something asks.
    const findings = checkCadence({
      activeEnrollments: 827,
      withoutNextAction: 0,
      stepsCompletedLastDay: 0,
      sentLastDay: 0,
    });
    expect(findings.find((f) => f.check === 'cadence-motion')?.level).toBe('fail');
  });

  it('does not call a healthy day dead because one timestamp was never written', () => {
    // Production, 2026-09-26: 28 sends, 28 tasks completed, 28 enrollments moved to step 2 —
    // and `lastTransitionAt` four days stale, because the advance path wrote `currentStep`
    // and forgot the timestamp. Measuring the timestamp would have raised a false alarm on a
    // system that was working; measuring completed tasks does not.
    const findings = checkCadence({
      activeEnrollments: 1105,
      withoutNextAction: 0,
      stepsCompletedLastDay: 28,
      sentLastDay: 28,
    });
    expect(findings.find((f) => f.check === 'cadence-motion')?.level).toBe('ok');
  });

  it('does not cry about an empty system', () => {
    const findings = checkCadence({
      activeEnrollments: 0,
      withoutNextAction: 0,
      stepsCompletedLastDay: 0,
      sentLastDay: 0,
    });
    expect(findings.every((f) => f.level === 'ok')).toBe(true);
  });
});

describe('send capacity', () => {
  it('warns when the backlog outruns the mailboxes carrying it', () => {
    // 279 steps behind one 80/day mailbox: three and a half days, and growing.
    const f = checkCapacity({ queued: 500, dailyCapacityInUse: 80 });
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('days of backlog');
  });

  it('fails when there is work queued and nothing sending it', () => {
    expect(checkCapacity({ queued: 67, dailyCapacityInUse: 0 }).level).toBe('fail');
  });

  it('is content with a backlog the mailboxes will clear', () => {
    expect(checkCapacity({ queued: 60, dailyCapacityInUse: 80 }).level).toBe('ok');
  });
});

describe('overall', () => {
  it('takes the worst level, so one failure is not averaged away', () => {
    expect(
      overall([
        { check: 'a', level: 'ok', detail: '' },
        { check: 'b', level: 'fail', detail: '' },
        { check: 'c', level: 'warn', detail: '' },
      ])
    ).toBe('fail');
    expect(overall([{ check: 'a', level: 'ok', detail: '' }])).toBe('ok');
  });
});
