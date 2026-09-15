import { describe, it, expect } from 'vitest';
import { inferTimezone } from '@/lib/time/inferTimezone';
import { describeZone } from '@/lib/time/describeZone';
import { convertTime } from '@/lib/time/convertTime';
import { TIMEZONE_OPTIONS, PINNED_TIMEZONES } from '@/lib/time/options';

/**
 * The time library behind the prospect clock, the booking modal and the converter.
 *
 * `inferTimezone` is deliberately conservative: it names a zone only for countries that have
 * exactly one, because the result is shown beside a Confirm button that writes `lead.timezone`,
 * and that column decides when sequence email goes out. A confident-looking wrong guess for the
 * US is worse than "unknown".
 */
describe('inferTimezone', () => {
  it.each([
    [{ country: 'Singapore' }, 'Asia/Singapore'],
    [{ country: 'SG' }, 'Asia/Singapore'],
    [{ country: 'singapore ' }, 'Asia/Singapore'],
    [{ country: 'Vietnam' }, 'Asia/Ho_Chi_Minh'],
    [{ country: 'Viet Nam' }, 'Asia/Ho_Chi_Minh'],
    [{ country: 'Việt Nam' }, 'Asia/Ho_Chi_Minh'],
    [{ country: 'Malaysia' }, 'Asia/Kuala_Lumpur'],
    [{ country: 'Japan' }, 'Asia/Tokyo'],
    [{ country: 'United Kingdom' }, 'Europe/London'],
    [{ country: 'UK' }, 'Europe/London'],
    [{ country: 'Germany' }, 'Europe/Berlin'],
    [{ country: 'Hong Kong' }, 'Asia/Hong_Kong'],
  ])('maps a single-zone country %o → %s', (input, expected) => {
    expect(inferTimezone(input)?.timezone).toBe(expected);
    expect(inferTimezone(input)?.confidence).toBe('exact');
  });

  it.each([
    ['+65 9123 4567', 'Asia/Singapore', '+65'],
    ['+84 90 123 4567', 'Asia/Ho_Chi_Minh', '+84'],
    ['0084901234567', 'Asia/Ho_Chi_Minh', '+84'],
    ['+60123456789', 'Asia/Kuala_Lumpur', '+60'],
    ['+44 20 7946 0958', 'Europe/London', '+44'],
    ['+81 3 1234 5678', 'Asia/Tokyo', '+81'],
  ])('maps a phone %s → %s (reason names the code %s)', (phone, expected, code) => {
    const r = inferTimezone({ phone });
    expect(r?.timezone).toBe(expected);
    expect(r?.reason).toContain(code);
  });

  it('prefers the country over the phone when both are present', () => {
    expect(inferTimezone({ country: 'Singapore', phone: '+84 90 000 0000' })?.timezone).toBe('Asia/Singapore');
  });

  it('refuses to guess for a multi-zone country', () => {
    for (const country of ['United States', 'US', 'USA', 'Australia', 'Canada', 'Brazil', 'Russia', 'Mexico', 'Indonesia']) {
      expect(inferTimezone({ country }), country).toBeNull();
    }
    expect(inferTimezone({ phone: '+1 415 555 0100' })).toBeNull();
    expect(inferTimezone({ phone: '+61 2 9999 9999' })).toBeNull();
  });

  it('returns null for nothing, junk, or a local number with no country code', () => {
    expect(inferTimezone({})).toBeNull();
    expect(inferTimezone({ country: 'Atlantis' })).toBeNull();
    expect(inferTimezone({ phone: '0901234567' })).toBeNull();
    expect(inferTimezone({ phone: 'call me' })).toBeNull();
  });
});

describe('describeZone', () => {
  it('describes Singapore on a Tuesday afternoon', () => {
    const d = describeZone('Asia/Singapore', new Date('2026-09-15T06:32:00Z')); // 14:32 SGT Tue
    expect(d.localTime).toBe('14:32');
    expect(d.weekday).toBe('Tue');
    expect(d.offsetLabel).toBe('GMT+8');
    expect(d.isBusinessHours).toBe(true);
  });

  it('marks evening and weekend as outside business hours', () => {
    expect(describeZone('Asia/Singapore', new Date('2026-09-15T12:00:00Z')).isBusinessHours).toBe(false); // 20:00
    expect(describeZone('Asia/Singapore', new Date('2026-09-13T04:00:00Z')).isBusinessHours).toBe(false); // Sun 12:00
    expect(describeZone('Asia/Singapore', new Date('2026-09-15T00:59:00Z')).isBusinessHours).toBe(false); // 08:59
    expect(describeZone('Asia/Singapore', new Date('2026-09-15T01:00:00Z')).isBusinessHours).toBe(true);  // 09:00
    expect(describeZone('Asia/Singapore', new Date('2026-09-15T10:00:00Z')).isBusinessHours).toBe(false); // 18:00 — exclusive
  });

  it('labels negative and half-hour offsets', () => {
    expect(describeZone('America/New_York', new Date('2026-01-15T12:00:00Z')).offsetLabel).toBe('GMT-5');
    expect(describeZone('Asia/Kolkata', new Date('2026-01-15T12:00:00Z')).offsetLabel).toBe('GMT+5:30');
    expect(describeZone('UTC', new Date()).offsetLabel).toBe('GMT+0');
  });

  it('throws on an invalid zone rather than silently using the machine clock', () => {
    expect(() => describeZone('Mars/Olympus', new Date())).toThrow();
  });
});

describe('convertTime', () => {
  it('renders one instant in several zones', () => {
    const rows = convertTime({
      date: '2026-09-15',
      hour: 15,
      minute: 0,
      fromZone: 'Australia/Sydney', // AEST = UTC+10 in September
      toZones: ['Asia/Ho_Chi_Minh', 'Asia/Singapore', 'Europe/London'],
    });
    expect(rows.map((r) => [r.timezone, r.localTime, r.dayShift])).toEqual([
      ['Asia/Ho_Chi_Minh', '12:00', 0],
      ['Asia/Singapore', '13:00', 0],
      ['Europe/London', '06:00', 0],
    ]);
  });

  it('reports a day shift when the conversion crosses midnight', () => {
    const rows = convertTime({ date: '2026-09-15', hour: 9, minute: 0, fromZone: 'America/Los_Angeles', toZones: ['Asia/Ho_Chi_Minh'] });
    expect(rows[0].localTime).toBe('23:00');
    expect(rows[0].dayShift).toBe(0);
    const late = convertTime({ date: '2026-09-15', hour: 18, minute: 0, fromZone: 'America/Los_Angeles', toZones: ['Asia/Ho_Chi_Minh'] });
    expect(late[0].localTime).toBe('08:00');
    expect(late[0].dayShift).toBe(1);
  });
});

describe('TIMEZONE_OPTIONS', () => {
  it('pins the zones the company uses first, then lists the rest grouped by region', () => {
    expect(TIMEZONE_OPTIONS[0].label).toBe('Pinned');
    expect(TIMEZONE_OPTIONS[0].zones.map((z) => z.id)).toEqual(PINNED_TIMEZONES);
    expect(PINNED_TIMEZONES[0]).toBe('Asia/Ho_Chi_Minh');
    expect(PINNED_TIMEZONES).toContain('Asia/Singapore');
    const all = TIMEZONE_OPTIONS.flatMap((g) => g.zones.map((z) => z.id));
    expect(all).toContain('Europe/Berlin');
    expect(all.filter((z) => z === 'Asia/Singapore')).toHaveLength(2); // pinned + in Asia
    expect(new Set(all.slice(PINNED_TIMEZONES.length)).size).toBe(all.length - PINNED_TIMEZONES.length);
  });

  it('labels each zone with its current offset', () => {
    const hcm = TIMEZONE_OPTIONS[0].zones.find((z) => z.id === 'Asia/Ho_Chi_Minh')!;
    expect(hcm.label).toMatch(/Ho Chi Minh.*GMT\+7/);
  });
});
