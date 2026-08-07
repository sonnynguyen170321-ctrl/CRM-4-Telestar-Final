import { describe, it, expect } from 'vitest';
import {
  buildIdempotencyKey,
  classifySendFailure,
  newRequestId,
  CLAIMABLE_STATUSES,
  TERMINAL_STATUSES,
  OUTBOUND_STATUS,
} from '@/lib/email/idempotency';

describe('buildIdempotencyKey', () => {
  it('gives one task one key, whatever the subject renders to', () => {
    // The regression that matters most: the old key hashed the subject, so a template
    // re-render between attempts produced a new key, no unique-constraint hit, and a
    // second delivery.
    const first = buildIdempotencyKey({ kind: 'task', taskId: 'task-1' });
    const second = buildIdempotencyKey({ kind: 'task', taskId: 'task-1' });
    expect(first).toBe(second);
    expect(first).toBe('manual-task:task-1');
  });

  it('keeps two different tasks apart even when they share lead, inbox and subject', () => {
    // The other half of the old bug: a re-enrollment or a follow-up step reusing a
    // subject line collided with the earlier send and was silently dropped.
    expect(buildIdempotencyKey({ kind: 'task', taskId: 'task-1' })).not.toBe(
      buildIdempotencyKey({ kind: 'task', taskId: 'task-2' })
    );
  });

  it('keys a sequence step on enrollment and step, not on rendered copy', () => {
    expect(
      buildIdempotencyKey({ kind: 'sequenceStep', enrollmentId: 'enr-1', stepId: 'step-2' })
    ).toBe('sequence-step:enr-1:step-2');
  });

  it('separates a re-enrollment of the same step from the original run', () => {
    expect(
      buildIdempotencyKey({ kind: 'sequenceStep', enrollmentId: 'enr-1', stepId: 'step-2' })
    ).not.toBe(
      buildIdempotencyKey({ kind: 'sequenceStep', enrollmentId: 'enr-2', stepId: 'step-2' })
    );
  });

  it('never lets two sources collide on the same underlying id', () => {
    const keys = new Set([
      buildIdempotencyKey({ kind: 'task', taskId: 'x' }),
      buildIdempotencyKey({ kind: 'manual', requestId: 'x' }),
      buildIdempotencyKey({ kind: 'reply', threadKey: 'x', requestId: 'x' }),
    ]);
    expect(keys.size).toBe(3);
  });

  it('refuses to build a key from an empty component', () => {
    expect(() => buildIdempotencyKey({ kind: 'task', taskId: '' })).toThrow(/taskId is empty/);
    expect(() => buildIdempotencyKey({ kind: 'task', taskId: '   ' })).toThrow(/taskId is empty/);
    expect(() =>
      buildIdempotencyKey({ kind: 'reply', threadKey: 'thread-1', requestId: '' })
    ).toThrow(/requestId is empty/);
  });
});

describe('newRequestId', () => {
  it('returns a distinct id per call', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

describe('classifySendFailure', () => {
  it.each([
    '550 5.1.1 message rejected',
    'Invalid login: 535 authentication failed',
    'invalid_grant: token expired',
    'No recipients defined',
    'Unknown email provider: carrier-pigeon',
    'connect ECONNREFUSED 127.0.0.1:465',
    'getaddrinfo ENOTFOUND smtp.example.test',
  ])('treats %s as definitely not sent', (message) => {
    expect(classifySendFailure(new Error(message))).toBe('not_sent');
  });

  it.each([
    'socket hang up',
    'ETIMEDOUT',
    'read ECONNRESET',
    'Request failed with status code 503',
    '',
  ])('treats %s as ambiguous', (message) => {
    expect(classifySendFailure(new Error(message))).toBe('ambiguous');
  });

  it('defaults an unrecognised non-Error throw to ambiguous', () => {
    // Anything we cannot prove was rejected must not become re-sendable.
    expect(classifySendFailure({ weird: true })).toBe('ambiguous');
    expect(classifySendFailure(undefined)).toBe('ambiguous');
  });
});

describe('status sets', () => {
  it('allows a worker to claim only pending and failed', () => {
    expect([...CLAIMABLE_STATUSES].sort()).toEqual(['failed', 'pending']);
  });

  it('excludes sending and reconciliation_required from the claimable set', () => {
    // These are the two states that mean "a provider call may have happened".
    expect(CLAIMABLE_STATUSES).not.toContain(OUTBOUND_STATUS.SENDING);
    expect(CLAIMABLE_STATUSES).not.toContain(OUTBOUND_STATUS.RECONCILIATION_REQUIRED);
  });

  it('treats sent and permanently_failed as terminal', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(['permanently_failed', 'sent']);
  });
});
