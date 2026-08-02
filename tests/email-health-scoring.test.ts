import { describe, it, expect } from 'vitest';
import { scoreInbox, levelForScore, SCORING_THRESHOLDS } from '@/lib/email-health/scoring';
import type { InboxHealthMetrics } from '@/lib/email-health/types';

const NOW = new Date('2026-08-02T12:00:00.000Z');
const FRESH_SYNC = new Date('2026-08-02T11:00:00.000Z'); // 1h old

/** A mailbox with nothing wrong with it: every deduction should be inactive. */
function healthyMetrics(overrides: Partial<InboxHealthMetrics> = {}): InboxHealthMetrics {
  return {
    isActive: true,
    isPaused: false,
    lastSyncAt: FRESH_SYNC,
    sentCount: 100,
    hardBounceCount: 0,
    softBounceCount: 0,
    replyCount: 5,
    spamSignalCount: 0,
    dailyCap: 80,
    dailySendCount: 10,
    dnsStatus: 'verified',
    ...overrides,
  };
}

describe('scoreInbox — baseline', () => {
  it('scores a clean mailbox 100 / healthy with no reasons', () => {
    const result = scoreInbox(healthyMetrics(), NOW);

    expect(result.score).toBe(100);
    expect(result.level).toBe('healthy');
    expect(result.reasonCodes).toEqual([]);
    expect(result.reasons).toEqual([]);
    expect(result.recommendedActions).toEqual([]);
  });

  it('derives rates without dividing by zero on an inbox that never sent', () => {
    const result = scoreInbox(
      healthyMetrics({ sentCount: 0, replyCount: 0, dailyCap: 0, dailySendCount: 0 }),
      NOW
    );

    expect(result.rates.hardBounceRate).toBe(0);
    expect(result.rates.replyRate).toBe(0);
    expect(result.rates.dailyUsageRate).toBe(0);
    expect(Number.isNaN(result.score)).toBe(false);
  });
});

describe('scoreInbox — stale sync boundary', () => {
  it('does not penalise a sync exactly at the 24h threshold', () => {
    const exactly24h = new Date(NOW.getTime() - SCORING_THRESHOLDS.STALE_SYNC_MS);
    const result = scoreInbox(healthyMetrics({ lastSyncAt: exactly24h }), NOW);

    expect(result.reasonCodes).not.toContain('stale_sync');
    expect(result.score).toBe(100);
  });

  it('penalises a sync one millisecond past 24h', () => {
    const justOver = new Date(NOW.getTime() - SCORING_THRESHOLDS.STALE_SYNC_MS - 1);
    const result = scoreInbox(healthyMetrics({ lastSyncAt: justOver }), NOW);

    expect(result.reasonCodes).toContain('stale_sync');
    expect(result.score).toBe(80);
  });

  it('treats a mailbox that has never synced as stale', () => {
    const result = scoreInbox(healthyMetrics({ lastSyncAt: null }), NOW);

    expect(result.reasonCodes).toContain('stale_sync');
  });
});

describe('scoreInbox — hard bounce bands', () => {
  it('ignores a hard bounce rate just below the elevated band', () => {
    // 1/100 = 1%, under the 2% elevated threshold
    const result = scoreInbox(healthyMetrics({ hardBounceCount: 1 }), NOW);

    expect(result.reasonCodes).not.toContain('hard_bounce_elevated');
    expect(result.score).toBe(100);
  });

  it('charges the elevated penalty exactly at 2%', () => {
    const result = scoreInbox(healthyMetrics({ hardBounceCount: 2 }), NOW);

    expect(result.reasonCodes).toContain('hard_bounce_elevated');
    expect(result.score).toBe(90);
  });

  it('still charges only the elevated penalty at exactly 5%', () => {
    const result = scoreInbox(healthyMetrics({ hardBounceCount: 5 }), NOW);

    expect(result.reasonCodes).toContain('hard_bounce_elevated');
    expect(result.reasonCodes).not.toContain('hard_bounce_critical');
    expect(result.score).toBe(90);
  });

  it('charges the critical penalty above 5%', () => {
    const result = scoreInbox(healthyMetrics({ hardBounceCount: 6 }), NOW);

    expect(result.reasonCodes).toContain('hard_bounce_critical');
    expect(result.score).toBe(80);
  });

  it('never charges both bounce bands at once', () => {
    const result = scoreInbox(healthyMetrics({ hardBounceCount: 50 }), NOW);

    const bandHits = result.reasonCodes.filter(
      (c) => c === 'hard_bounce_critical' || c === 'hard_bounce_elevated'
    );
    expect(bandHits).toHaveLength(1);
  });
});

describe('scoreInbox — other thresholds', () => {
  it('penalises soft bounce rate only above 8%', () => {
    expect(scoreInbox(healthyMetrics({ softBounceCount: 8 }), NOW).reasonCodes)
      .not.toContain('soft_bounce_elevated');
    expect(scoreInbox(healthyMetrics({ softBounceCount: 9 }), NOW).reasonCodes)
      .toContain('soft_bounce_elevated');
  });

  it('penalises spam signals only above 1%', () => {
    expect(scoreInbox(healthyMetrics({ spamSignalCount: 1 }), NOW).reasonCodes)
      .not.toContain('spam_signals');
    expect(scoreInbox(healthyMetrics({ spamSignalCount: 2 }), NOW).reasonCodes)
      .toContain('spam_signals');
  });

  it('penalises daily usage only above 90 percent', () => {
    expect(scoreInbox(healthyMetrics({ dailyCap: 100, dailySendCount: 90 }), NOW).reasonCodes)
      .not.toContain('daily_cap_nearly_exhausted');
    expect(scoreInbox(healthyMetrics({ dailyCap: 100, dailySendCount: 91 }), NOW).reasonCodes)
      .toContain('daily_cap_nearly_exhausted');
  });

  it('flags zero replies only once send volume is meaningful', () => {
    const belowVolume = SCORING_THRESHOLDS.MEANINGFUL_SEND_VOLUME - 1;
    expect(scoreInbox(healthyMetrics({ sentCount: belowVolume, replyCount: 0 }), NOW).reasonCodes)
      .not.toContain('no_replies_at_volume');

    expect(
      scoreInbox(
        healthyMetrics({ sentCount: SCORING_THRESHOLDS.MEANINGFUL_SEND_VOLUME, replyCount: 0 }),
        NOW
      ).reasonCodes
    ).toContain('no_replies_at_volume');
  });

  it('penalises unverified DNS only for a mailbox that is actually sending', () => {
    expect(scoreInbox(healthyMetrics({ dnsStatus: 'unknown', sentCount: 0, replyCount: 0 }), NOW).reasonCodes)
      .not.toContain('dns_unverified');
    expect(scoreInbox(healthyMetrics({ dnsStatus: 'unknown' }), NOW).reasonCodes)
      .toContain('dns_unverified');
    expect(scoreInbox(healthyMetrics({ dnsStatus: 'failed' }), NOW).reasonCodes)
      .toContain('dns_unverified');
  });

  it('penalises an inactive mailbox', () => {
    const result = scoreInbox(healthyMetrics({ isActive: false }), NOW);

    expect(result.reasonCodes).toContain('mailbox_inactive');
    expect(result.score).toBe(75);
  });
});

describe('levelForScore — band cutoffs', () => {
  it.each([
    [100, 'healthy'],
    [90, 'healthy'],
    [89, 'watch'],
    [75, 'watch'],
    [74, 'at_risk'],
    [50, 'at_risk'],
    [49, 'critical'],
    [0, 'critical'],
  ])('maps %i to %s', (score, expected) => {
    expect(levelForScore(score)).toBe(expected);
  });
});

describe('scoreInbox — clamping and paused state', () => {
  it('never returns a negative score when every penalty fires', () => {
    const result = scoreInbox(
      {
        isActive: false,
        isPaused: false,
        lastSyncAt: null,
        sentCount: 100,
        hardBounceCount: 90,
        softBounceCount: 50,
        replyCount: 0,
        spamSignalCount: 50,
        dailyCap: 10,
        dailySendCount: 10,
        dnsStatus: 'failed',
      },
      NOW
    );

    expect(result.score).toBe(0);
    expect(result.level).toBe('critical');
  });

  it('reports a manually paused mailbox as paused regardless of its score', () => {
    const result = scoreInbox(healthyMetrics({ isPaused: true }), NOW);

    expect(result.level).toBe('paused');
    expect(result.score).toBe(100); // score is still reported truthfully
    expect(result.reasonCodes[0]).toBe('send_paused');
  });

  it('keeps underlying fault reasons visible while paused', () => {
    const result = scoreInbox(healthyMetrics({ isPaused: true, hardBounceCount: 20 }), NOW);

    expect(result.level).toBe('paused');
    expect(result.reasonCodes).toContain('send_paused');
    expect(result.reasonCodes).toContain('hard_bounce_critical');
  });
});

describe('scoreInbox — reason and action mapping', () => {
  it('emits a label and an action for every reason code', () => {
    const result = scoreInbox(
      healthyMetrics({ isActive: false, lastSyncAt: null, hardBounceCount: 20 }),
      NOW
    );

    expect(result.reasons).toHaveLength(result.reasonCodes.length);
    expect(result.recommendedActions).toHaveLength(result.reasonCodes.length);
    expect(result.reasons.every((r) => typeof r === 'string' && r.length > 0)).toBe(true);
    expect(result.recommendedActions.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
  });
});
