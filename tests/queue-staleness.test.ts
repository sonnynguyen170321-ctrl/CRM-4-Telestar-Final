/**
 * The check that would have caught it.
 *
 * Inbox sync stopped on 2026-08-26 and resumed only when something happened to free its BullMQ
 * job id — 30 messages on 09-10, 8 on 09-15, none in between. Every surface stayed green: the
 * cron logged `{"accounts":4,"enqueued":4}` every two minutes, the queue was empty, and the
 * `JobRun` rows said `queued`. Nothing anywhere compared those three facts to each other.
 *
 * Two questions catch it, and neither needs to know why:
 *   - is a `JobRun` sitting at `queued` with no live BullMQ job behind it?
 *   - has a job that is supposed to run every few minutes actually completed lately?
 */
import { describe, expect, it } from 'vitest';

import { findStaleness, type StalenessPolicy } from '@/lib/ops/queueStaleness';

const NOW = new Date('2026-09-16T17:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

const POLICY: StalenessPolicy = {
  stuckAfterMs: 10 * 60_000,
  recurrences: { 'email.sync': 15 * 60_000 },
};

describe('stuck jobs — queued in Postgres, absent from Redis', () => {
  it('reports a queued JobRun with no live BullMQ job', () => {
    const findings = findStaleness(
      {
        now: NOW,
        queued: [{ id: 'jr-1', jobName: 'email.sync', enqueuedAt: minutesAgo(30), live: false }],
        lastCompleted: { 'email.sync': minutesAgo(1) },
      },
      POLICY
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'stuck_job', jobName: 'email.sync' });
    expect(findings[0].detail).toContain('jr-1');
  });

  it('says nothing about a queued job that is genuinely waiting in the queue', () => {
    const findings = findStaleness(
      {
        now: NOW,
        queued: [{ id: 'jr-2', jobName: 'import.commit', enqueuedAt: minutesAgo(30), live: true }],
        lastCompleted: { 'email.sync': minutesAgo(1) },
      },
      POLICY
    );
    expect(findings).toEqual([]);
  });

  it('gives a fresh enqueue time to be picked up before calling it stuck', () => {
    const findings = findStaleness(
      {
        now: NOW,
        queued: [{ id: 'jr-3', jobName: 'email.sync', enqueuedAt: minutesAgo(2), live: false }],
        lastCompleted: { 'email.sync': minutesAgo(1) },
      },
      POLICY
    );
    expect(findings).toEqual([]);
  });

  it('reports every stuck row, not just the first', () => {
    const findings = findStaleness(
      {
        now: NOW,
        queued: [
          { id: 'jr-4', jobName: 'email.sync', enqueuedAt: minutesAgo(30), live: false },
          { id: 'jr-5', jobName: 'import.commit', enqueuedAt: minutesAgo(90), live: false },
        ],
        lastCompleted: { 'email.sync': minutesAgo(1) },
      },
      POLICY
    );
    expect(findings.map((f) => f.jobName).sort()).toEqual(['email.sync', 'import.commit']);
  });
});

describe('stale recurrences — a job that should have run and did not', () => {
  it('reports a recurring job whose last success is older than its budget', () => {
    const findings = findStaleness(
      { now: NOW, queued: [], lastCompleted: { 'email.sync': minutesAgo(45) } },
      POLICY
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'stale_recurrence', jobName: 'email.sync' });
    expect(findings[0].detail).toContain('45');
  });

  it('accepts a recurring job that completed inside its budget', () => {
    const findings = findStaleness(
      { now: NOW, queued: [], lastCompleted: { 'email.sync': minutesAgo(3) } },
      POLICY
    );
    expect(findings).toEqual([]);
  });

  it('treats never-completed as stale rather than as nothing to say', () => {
    // The dangerous reading of a missing row is "no news is good news". On 2026-09-16 the
    // production table held exactly one completed `email.sync`, six days old, beneath five
    // queued ones.
    const findings = findStaleness(
      { now: NOW, queued: [], lastCompleted: { 'email.sync': null } },
      POLICY
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('stale_recurrence');
    expect(findings[0].detail).toContain('never');
  });

  it('is silent on a healthy system', () => {
    const findings = findStaleness(
      {
        now: NOW,
        queued: [{ id: 'jr-6', jobName: 'email.sync', enqueuedAt: minutesAgo(1), live: true }],
        lastCompleted: { 'email.sync': minutesAgo(2) },
      },
      POLICY
    );
    expect(findings).toEqual([]);
  });
});
