import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { nextBusinessDay, snapToBusinessDay, isWeekend } from '@/lib/dates/businessDays';

/**
 * "Next business day at 09:00" has to mean 09:00 where the rep works.
 *
 * These helpers used `getDay()` and `setHours(9)`, which are the server's local clock. The
 * containers run in UTC, so a callback task due "next business day at 09:00" was due at 09:00
 * UTC — 16:00 in Ho Chi Minh City, mid-afternoon — and a call logged at 01:00 ICT on a Monday
 * counted as Sunday, pushing the follow-up out an extra day. The sequence engine already does
 * this correctly through Intl (lib/automation/timezone.ts); these two callers did not.
 */
const HCM = 'Asia/Ho_Chi_Minh'; // UTC+7, no DST

// Pinned to the container's clock for the duration of this file, and restored after. On a
// developer machine in Vietnam these pass against the OLD implementation by coincidence — local
// time is UTC+7 — which is exactly how the bug shipped.
let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe('nextBusinessDay in a timezone', () => {
  it('Friday → Monday 09:00 local, expressed in UTC', () => {
    // Fri 2026-09-11 17:00 ICT
    const from = new Date('2026-09-11T10:00:00Z');
    expect(nextBusinessDay(from, HCM).toISOString()).toBe('2026-09-14T02:00:00.000Z');
  });

  it('Tuesday → Wednesday 09:00 local', () => {
    const from = new Date('2026-09-15T08:00:00Z'); // Tue 15:00 ICT
    expect(nextBusinessDay(from, HCM).toISOString()).toBe('2026-09-16T02:00:00.000Z');
  });

  it('uses the local calendar day, not the UTC one, at the boundary', () => {
    // 2026-09-13T18:30Z is Sunday in UTC but already Monday 01:30 in ICT.
    // Next business day is Tuesday — a UTC-local computation would say Monday.
    const from = new Date('2026-09-13T18:30:00Z');
    expect(nextBusinessDay(from, HCM).toISOString()).toBe('2026-09-15T02:00:00.000Z');
  });

  it('handles a DST timezone through the transition', () => {
    // Europe/London, Fri 2026-10-23 → Mon 2026-10-26 (BST ends 25 Oct). 09:00 GMT = 09:00Z.
    const from = new Date('2026-10-23T12:00:00Z');
    expect(nextBusinessDay(from, 'Europe/London').toISOString()).toBe('2026-10-26T09:00:00.000Z');
  });
});

describe('snapToBusinessDay in a timezone', () => {
  it('leaves a weekday alone', () => {
    const d = new Date('2026-09-16T05:00:00Z'); // Wed 12:00 ICT
    expect(snapToBusinessDay(d, HCM)).toEqual(d);
  });

  it('moves a local Saturday to Monday 09:00 local', () => {
    // 2026-09-11T23:00Z is Friday in UTC but Saturday 06:00 ICT.
    const d = new Date('2026-09-11T23:00:00Z');
    expect(snapToBusinessDay(d, HCM).toISOString()).toBe('2026-09-14T02:00:00.000Z');
  });
});

describe('isWeekend in a timezone', () => {
  it('answers for the local day', () => {
    const sundayNightUtc = new Date('2026-09-13T18:30:00Z'); // Mon 01:30 ICT
    expect(isWeekend(sundayNightUtc, HCM)).toBe(false);
    expect(isWeekend(sundayNightUtc, 'UTC')).toBe(true);
  });
});
