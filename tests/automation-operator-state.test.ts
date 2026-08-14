import { describe, it, expect } from 'vitest';

import {
  deriveOperatorReason,
  type OperatorStateInput,
} from '@/lib/automation/operatorState';

/**
 * The operator answer to "why did this prospect not get Email 2 today?" (Plan 1 §A6).
 *
 * Two things are under test: that the right reason wins when several are true at once, and that
 * nothing the operator reads leaks internal vocabulary. The second is enforced structurally at
 * the bottom of this file rather than by review — a `DEFER` or a queue name reaching the UI is a
 * regression that reads as merely cosmetic and is not.
 */

const NOW = new Date('2026-08-14T10:00:00.000Z');
const SOON = new Date('2026-08-14T15:00:00.000Z');
const EARLIER = new Date('2026-08-14T08:00:00.000Z');

function input(over: Partial<OperatorStateInput> = {}): OperatorStateInput {
  return {
    enrollment: {
      status: 'active',
      currentStep: 2,
      nextActionAt: SOON,
      pausedReason: null,
    },
    task: { status: 'pending', dueDate: SOON },
    account: {
      isActive: true,
      sendPausedAt: null,
      dailyCap: 100,
      dailySendCount: 4,
      dailySendDate: new Date('2026-08-14T00:00:00.000Z'),
      healthLevel: 'healthy',
    },
    stepLabel: 'Email 2',
    now: NOW,
    ...over,
  };
}

describe('deriveOperatorReason', () => {
  it('reports a scheduled step as waiting, with the time it is waiting for', () => {
    const reason = deriveOperatorReason(input());

    expect(reason.reasonCode).toBe('waiting_for_next_step');
    expect(reason.nextActionAt).toEqual(SOON);
    expect(reason.needsAttention).toBe(false);
    expect(reason.detail).toContain('Email 2');
  });

  it('reports a due-but-unsent step as outside sending hours', () => {
    const reason = deriveOperatorReason(
      input({
        enrollment: { status: 'active', currentStep: 2, nextActionAt: EARLIER, pausedReason: null },
        task: { status: 'pending', dueDate: EARLIER },
      })
    );

    expect(reason.reasonCode).toBe('outside_send_window');
    expect(reason.reasonLabel).toBe('Outside sending hours');
  });

  it('reports an exhausted mailbox as capacity, and keeps the retry time', () => {
    const reason = deriveOperatorReason(
      input({
        account: {
          isActive: true,
          sendPausedAt: null,
          dailyCap: 50,
          dailySendCount: 50,
          dailySendDate: new Date('2026-08-14T00:00:00.000Z'),
          healthLevel: 'healthy',
        },
      })
    );

    expect(reason.reasonCode).toBe('quota_deferred');
    expect(reason.reasonLabel).toBe('Waiting for mailbox capacity');
    expect(reason.nextActionAt).toEqual(SOON);
  });

  it('does not treat yesterday’s send count as today’s quota', () => {
    const reason = deriveOperatorReason(
      input({
        account: {
          isActive: true,
          sendPausedAt: null,
          dailyCap: 50,
          dailySendCount: 50,
          dailySendDate: new Date('2026-08-13T00:00:00.000Z'),
          healthLevel: 'healthy',
        },
      })
    );

    expect(reason.reasonCode).toBe('waiting_for_next_step');
  });

  it('flags a missing mailbox as needing a person', () => {
    const reason = deriveOperatorReason(input({ account: null }));

    expect(reason.reasonCode).toBe('mailbox_unavailable');
    expect(reason.needsAttention).toBe(true);
  });

  it('flags a manager-paused mailbox as a hold rather than a stop', () => {
    const reason = deriveOperatorReason(
      input({
        account: {
          isActive: true,
          sendPausedAt: new Date('2026-08-13T00:00:00.000Z'),
          dailyCap: 100,
          dailySendCount: 0,
          dailySendDate: null,
          healthLevel: 'critical',
        },
      })
    );

    expect(reason.reasonCode).toBe('deliverability_hold');
    expect(reason.needsAttention).toBe(true);
  });

  it('translates each stored pause reason into its own operator reason', () => {
    const cases: Array<[string, string]> = [
      ['reply', 'prospect_replied'],
      ['hard_bounce', 'email_bounced'],
      ['meeting_booked', 'meeting_booked'],
      ['manual', 'paused_by_user'],
      ['campaign_paused', 'campaign_paused'],
      ['mailbox_unavailable', 'mailbox_unavailable'],
      ['soft_bounce', 'retry_pending'],
      ['email_health', 'deliverability_hold'],
    ];

    for (const [stored, expected] of cases) {
      const reason = deriveOperatorReason(
        input({
          enrollment: { status: 'paused', currentStep: 2, nextActionAt: SOON, pausedReason: stored },
        })
      );
      expect(reason.reasonCode).toBe(expected);
    }
  });

  it('still renders a legacy pause token rather than showing the raw value', () => {
    const reason = deriveOperatorReason(
      input({
        // Written before the vocabularies were collapsed.
        enrollment: { status: 'paused', currentStep: 2, nextActionAt: null, pausedReason: 'replied' },
      })
    );

    expect(reason.reasonCode).toBe('prospect_replied');
    expect(reason.reasonLabel).toBe('Paused — prospect replied');
    // The normalizer resolved the legacy token; the stored string itself never reaches the UI.
    expect(reason.detail).toContain('prospect replied');
  });

  it('reports a stopped cadence as finished even when its mailbox is also broken', () => {
    const reason = deriveOperatorReason(
      input({
        enrollment: { status: 'completed', currentStep: 3, nextActionAt: null, pausedReason: null },
        account: null,
      })
    );

    // Sending an operator to fix a mailbox for a prospect who already replied is the wrong screen.
    expect(reason.reasonCode).toBe('finished');
    expect(reason.needsAttention).toBe(false);
  });

  it('prefers the recorded pause reason over anything it could re-derive', () => {
    const reason = deriveOperatorReason(
      input({
        enrollment: { status: 'paused', currentStep: 2, nextActionAt: SOON, pausedReason: 'reply' },
        account: null, // also true, and also not the point
      })
    );

    expect(reason.reasonCode).toBe('prospect_replied');
  });
});

describe('operator vocabulary stays out of the engine’s vocabulary', () => {
  /** Words that describe how the system works rather than what happened to the prospect. */
  const FORBIDDEN = [
    'DEFER',
    'BLOCK',
    'TERMINATE',
    'ALLOW',
    'MANUAL_REQUIRED',
    'bullmq',
    'queue',
    'job',
    'worker',
    'enqueue',
    'redis',
    'eligibility',
    'occurrence',
    'enrollment',
  ];

  const everyState: OperatorStateInput[] = [
    input(),
    input({ account: null }),
    input({ enrollment: { status: 'paused', currentStep: 1, nextActionAt: null, pausedReason: 'reply' } }),
    input({ enrollment: { status: 'paused', currentStep: 1, nextActionAt: null, pausedReason: 'hard_bounce' } }),
    input({ enrollment: { status: 'completed', currentStep: 3, nextActionAt: null, pausedReason: null } }),
    input({
      account: {
        isActive: true,
        sendPausedAt: null,
        dailyCap: 10,
        dailySendCount: 10,
        dailySendDate: new Date('2026-08-14T00:00:00.000Z'),
        healthLevel: 'healthy',
      },
    }),
    input({
      enrollment: { status: 'active', currentStep: 2, nextActionAt: EARLIER, pausedReason: null },
      task: { status: 'pending', dueDate: EARLIER },
    }),
  ];

  it('never puts an internal term in front of an operator', () => {
    for (const state of everyState) {
      const reason = deriveOperatorReason(state);
      const shown = `${reason.reasonLabel} ${reason.detail}`.toLowerCase();
      for (const term of FORBIDDEN) {
        expect(shown).not.toContain(term.toLowerCase());
      }
    }
  });

  it('gives every state a label and a sentence, so no cadence renders blank', () => {
    for (const state of everyState) {
      const reason = deriveOperatorReason(state);
      expect(reason.reasonLabel.length).toBeGreaterThan(0);
      expect(reason.detail.length).toBeGreaterThan(0);
      expect(reason.detail.endsWith('.')).toBe(true);
    }
  });
});
