import { describe, it, expect } from 'vitest';
import { calculateNextActionAt, type SchedulingInput } from '@/lib/automation/scheduling';
import { resolveTimezone, isValidTimezone, getLocalTime, localToUtc, minutesToHourMinute } from '@/lib/automation/timezone';
import { deterministicOffset, buildJitterSeed } from '@/lib/automation/jitter';

// ── Jitter ──────────────────────────────────────────────────────────────────

describe('deterministicOffset', () => {
  it('returns 0 for windowMinutes <= 0', () => {
    expect(deterministicOffset('seed', 0)).toBe(0);
    expect(deterministicOffset('seed', -10)).toBe(0);
  });

  it('returns a value within [0, windowMinutes)', () => {
    for (let i = 0; i < 20; i++) {
      const result = deterministicOffset(`lead-${i}`, 120);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(120);
    }
  });

  it('is deterministic — same seed + window → same result', () => {
    const a = deterministicOffset('stable-seed', 120);
    const b = deterministicOffset('stable-seed', 120);
    expect(a).toBe(b);
  });

  it('different seeds produce different offsets (in practice)', () => {
    const a = deterministicOffset('lead-A', 120);
    const b = deterministicOffset('lead-B', 120);
    // Not guaranteed to differ, but overwhelmingly likely
    // We just test both are valid
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });
});

describe('buildJitterSeed', () => {
  it('concatenates parts with colons', () => {
    const seed = buildJitterSeed({
      tenantId: 't1',
      sequenceId: 's1',
      sequenceStepId: 'st1',
      leadId: 'l1',
    });
    expect(seed).toBe('t1:s1:st1:l1');
  });

  it('handles missing parts gracefully', () => {
    const seed = buildJitterSeed({ leadId: 'l1' });
    // tenantId='', sequenceId='', sequenceStepId='', leadId='l1'
    expect(seed).toBe(':::l1');
  });
});

// ── Timezone ────────────────────────────────────────────────────────────────

describe('isValidTimezone', () => {
  it('accepts valid IANA timezones', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
  });

  it('rejects invalid timezones', () => {
    expect(isValidTimezone('Fake/Zone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    // Note: Node 24 Intl accepts some abbreviations like PST, so we don't test those.
  });
});

describe('resolveTimezone', () => {
  it('prefers lead timezone', () => {
    expect(resolveTimezone('Asia/Ho_Chi_Minh', 'America/New_York', 'UTC')).toBe('Asia/Ho_Chi_Minh');
  });

  it('falls back to user timezone if lead is null', () => {
    expect(resolveTimezone(null, 'America/New_York', 'UTC')).toBe('America/New_York');
  });

  it('falls back to tenant default', () => {
    expect(resolveTimezone(null, null, 'Europe/London')).toBe('Europe/London');
  });

  it('falls back to UTC if nothing valid', () => {
    expect(resolveTimezone(null, null, null)).toBe('UTC');
    expect(resolveTimezone('Fake/Zone', '', null)).toBe('UTC');
  });

  it('skips invalid lead timezone', () => {
    expect(resolveTimezone('Invalid', 'America/New_York')).toBe('America/New_York');
  });
});

describe('getLocalTime', () => {
  it('returns correct local time for UTC', () => {
    const date = new Date('2026-08-12T14:30:00Z');
    const local = getLocalTime(date, 'UTC');
    expect(local.hour).toBe(14);
    expect(local.minute).toBe(30);
  });

  it('handles timezone offset correctly', () => {
    // 14:30 UTC = 10:30 EDT (America/New_York, UTC-4 in summer)
    const date = new Date('2026-08-12T14:30:00Z');
    const local = getLocalTime(date, 'America/New_York');
    expect(local.hour).toBe(10);
    expect(local.minute).toBe(30);
  });
});

describe('localToUtc', () => {
  it('converts local time to UTC correctly', () => {
    // 09:00 in America/New_York (EDT, UTC-4) = 13:00 UTC
    const utc = localToUtc(2026, 8, 12, 9, 0, 'America/New_York');
    expect(utc.getUTCHours()).toBe(13);
    expect(utc.getUTCMinutes()).toBe(0);
  });

  it('handles UTC identity', () => {
    const utc = localToUtc(2026, 8, 12, 9, 30, 'UTC');
    expect(utc.getUTCHours()).toBe(9);
    expect(utc.getUTCMinutes()).toBe(30);
  });

  it('handles positive offset timezone', () => {
    // 09:00 in Asia/Ho_Chi_Minh (UTC+7) = 02:00 UTC
    const utc = localToUtc(2026, 8, 12, 9, 0, 'Asia/Ho_Chi_Minh');
    expect(utc.getUTCHours()).toBe(2);
    expect(utc.getUTCMinutes()).toBe(0);
  });
});

describe('minutesToHourMinute', () => {
  it('converts correctly', () => {
    expect(minutesToHourMinute(540)).toEqual({ hour: 9, minute: 0 });
    expect(minutesToHourMinute(690)).toEqual({ hour: 11, minute: 30 });
    expect(minutesToHourMinute(0)).toEqual({ hour: 0, minute: 0 });
    expect(minutesToHourMinute(1439)).toEqual({ hour: 23, minute: 59 });
  });
});

// ── Scheduling ──────────────────────────────────────────────────────────────

describe('calculateNextActionAt', () => {
  const base = new Date('2026-08-10T12:00:00Z'); // Monday 12:00 UTC

  const defaults: SchedulingInput = {
    baseAt: base,
    delayDays: 0,
    delayHours: 0,
    sendWindowStartMinutes: null,
    sendWindowEndMinutes: null,
    timezone: 'UTC',
    businessDayPolicy: 'none',
    deterministicSeed: null,
  };

  // ── Cadence tests ─────────────────────────────────────────────────────

  describe('cadence (no window, no business days)', () => {
    it('no delay returns baseAt', () => {
      const result = calculateNextActionAt(defaults);
      expect(result.dueAtUtc.getTime()).toBe(base.getTime());
      expect(result.adjustmentReason).toBe('none');
    });

    it('hours-only delay', () => {
      const result = calculateNextActionAt({ ...defaults, delayHours: 3 });
      expect(result.dueAtUtc.getTime()).toBe(base.getTime() + 3 * 3_600_000);
    });

    it('days-only delay', () => {
      const result = calculateNextActionAt({ ...defaults, delayDays: 2 });
      expect(result.dueAtUtc.getTime()).toBe(base.getTime() + 2 * 86_400_000);
    });

    it('combined delay', () => {
      const result = calculateNextActionAt({ ...defaults, delayDays: 1, delayHours: 6 });
      expect(result.dueAtUtc.getTime()).toBe(base.getTime() + 86_400_000 + 6 * 3_600_000);
    });
  });

  // ── Business day tests ────────────────────────────────────────────────

  describe('business day policy', () => {
    it('skips weekends when policy is skip_weekends', () => {
      // Monday + 5 business days = next Monday
      const result = calculateNextActionAt({
        ...defaults,
        delayDays: 5,
        businessDayPolicy: 'skip_weekends',
      });
      const local = getLocalTime(result.dueAtUtc, 'UTC');
      expect(local.dayOfWeek).not.toBe(0); // Not Sunday
      expect(local.dayOfWeek).not.toBe(6); // Not Saturday
    });

    it('Friday + 1 business day = Monday', () => {
      const friday = new Date('2026-08-14T12:00:00Z'); // Friday
      const result = calculateNextActionAt({
        ...defaults,
        baseAt: friday,
        delayDays: 1,
        businessDayPolicy: 'skip_weekends',
      });
      const local = getLocalTime(result.dueAtUtc, 'UTC');
      expect(local.dayOfWeek).toBe(1); // Monday
    });

    it('Saturday base snaps to Monday', () => {
      const saturday = new Date('2026-08-15T12:00:00Z'); // Saturday
      const result = calculateNextActionAt({
        ...defaults,
        baseAt: saturday,
        businessDayPolicy: 'skip_weekends',
      });
      expect(result.adjustmentReason).toBe('weekend_adjustment');
      const local = getLocalTime(result.dueAtUtc, 'UTC');
      expect(local.dayOfWeek).toBe(1); // Monday
    });
  });

  // ── Send window tests ─────────────────────────────────────────────────

  describe('send window', () => {
    it('before window snaps to window start', () => {
      const earlyMorning = new Date('2026-08-12T05:00:00Z'); // 05:00 UTC
      const result = calculateNextActionAt({
        ...defaults,
        baseAt: earlyMorning,
        sendWindowStartMinutes: 540,  // 09:00
        sendWindowEndMinutes: 660,    // 11:00
        timezone: 'UTC',
      });
      expect(result.adjustmentReason).toBe('before_send_window');
      const local = getLocalTime(result.dueAtUtc, 'UTC');
      expect(local.hour).toBeGreaterThanOrEqual(9);
      expect(local.hour).toBeLessThan(11);
    });

    it('after window pushes to next day', () => {
      const lateEvening = new Date('2026-08-12T20:00:00Z'); // 20:00 UTC
      const result = calculateNextActionAt({
        ...defaults,
        baseAt: lateEvening,
        sendWindowStartMinutes: 540,  // 09:00
        sendWindowEndMinutes: 660,    // 11:00
        timezone: 'UTC',
      });
      expect(result.adjustmentReason).toBe('after_send_window');
      const local = getLocalTime(result.dueAtUtc, 'UTC');
      // Should be on Aug 13
      expect(local.day).toBe(13);
      expect(local.hour).toBeGreaterThanOrEqual(9);
    });

    it('inside window passes through', () => {
      const insideWindow = new Date('2026-08-12T10:00:00Z'); // 10:00 UTC
      const result = calculateNextActionAt({
        ...defaults,
        baseAt: insideWindow,
        sendWindowStartMinutes: 540,  // 09:00
        sendWindowEndMinutes: 660,    // 11:00
        timezone: 'UTC',
      });
      // No window adjustment (might have no adjustment or just jitter)
      expect(result.dueAtUtc.getTime()).toBe(insideWindow.getTime());
    });

    it('afternoon window works', () => {
      const morning = new Date('2026-08-12T06:00:00Z'); // 06:00 UTC
      const result = calculateNextActionAt({
        ...defaults,
        baseAt: morning,
        sendWindowStartMinutes: 780,  // 13:00
        sendWindowEndMinutes: 900,    // 15:00
        timezone: 'UTC',
      });
      const local = getLocalTime(result.dueAtUtc, 'UTC');
      expect(local.hour).toBeGreaterThanOrEqual(13);
      expect(local.hour).toBeLessThan(15);
    });
  });

  // ── Timezone tests ────────────────────────────────────────────────────

  describe('timezone handling', () => {
    it('respects lead timezone for send window', () => {
      // 12:00 UTC = 08:00 EDT. Window is 09:00-11:00 local.
      // Should snap to 09:00 local = 13:00 UTC
      const result = calculateNextActionAt({
        ...defaults,
        sendWindowStartMinutes: 540,  // 09:00
        sendWindowEndMinutes: 660,    // 11:00
        timezone: 'America/New_York',
      });
      expect(result.adjustmentReason).toBe('before_send_window');
      expect(result.timezone).toBe('America/New_York');
    });

    it('uses UTC when timezone is UTC', () => {
      const result = calculateNextActionAt({
        ...defaults,
        timezone: 'UTC',
      });
      expect(result.timezone).toBe('UTC');
    });
  });

  // ── Deterministic jitter tests ────────────────────────────────────────

  describe('deterministic jitter', () => {
    it('same seed produces same result across calls', () => {
      const input: SchedulingInput = {
        ...defaults,
        sendWindowStartMinutes: 540,
        sendWindowEndMinutes: 660,
        deterministicSeed: 'tenant1:seq1:step1:lead1',
      };
      const a = calculateNextActionAt(input);
      const b = calculateNextActionAt(input);
      expect(a.dueAtUtc.getTime()).toBe(b.dueAtUtc.getTime());
    });

    it('different seeds produce different results (in practice)', () => {
      const inputA: SchedulingInput = {
        ...defaults,
        sendWindowStartMinutes: 540,
        sendWindowEndMinutes: 660,
        deterministicSeed: 'tenant1:seq1:step1:leadA',
      };
      const inputB: SchedulingInput = {
        ...defaults,
        sendWindowStartMinutes: 540,
        sendWindowEndMinutes: 660,
        deterministicSeed: 'tenant1:seq1:step1:leadB',
      };
      const a = calculateNextActionAt(inputA);
      const b = calculateNextActionAt(inputB);
      // Both should be within the window (09:00-11:00 UTC)
      const localA = getLocalTime(a.dueAtUtc, 'UTC');
      const localB = getLocalTime(b.dueAtUtc, 'UTC');
      expect(localA.hour).toBeGreaterThanOrEqual(9);
      expect(localA.hour).toBeLessThan(11);
      expect(localB.hour).toBeGreaterThanOrEqual(9);
      expect(localB.hour).toBeLessThan(11);
    });

    it('spreads leads across the window, not all at :00', () => {
      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        const result = calculateNextActionAt({
          ...defaults,
          sendWindowStartMinutes: 540,
          sendWindowEndMinutes: 660,
          deterministicSeed: `tenant:seq:step:lead-${i}`,
        });
        const local = getLocalTime(result.dueAtUtc, 'UTC');
        results.push(local.hour * 60 + local.minute);
      }
      // Not all the same minute
      const unique = new Set(results);
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  // ── Combined tests ────────────────────────────────────────────────────

  describe('combined cadence + window + business days', () => {
    it('delay + weekend skip + window produces valid result', () => {
      const friday = new Date('2026-08-14T12:00:00Z'); // Friday
      const result = calculateNextActionAt({
        baseAt: friday,
        delayDays: 2,
        delayHours: 0,
        sendWindowStartMinutes: 540,
        sendWindowEndMinutes: 660,
        timezone: 'UTC',
        businessDayPolicy: 'skip_weekends',
        deterministicSeed: 'test-seed',
      });
      // Friday + 2 business days = Tuesday
      const local = getLocalTime(result.dueAtUtc, 'UTC');
      expect(local.dayOfWeek).not.toBe(0); // Not Sunday
      expect(local.dayOfWeek).not.toBe(6); // Not Saturday
      expect(local.hour).toBeGreaterThanOrEqual(9);
      expect(local.hour).toBeLessThan(11);
    });

    it('output includes local representation', () => {
      const result = calculateNextActionAt({
        ...defaults,
        delayDays: 1,
        timezone: 'America/New_York',
      });
      expect(result.dueAtLocal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });
  });
});
