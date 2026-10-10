import { describe, expect, it, vi } from 'vitest';

import { evaluateCallPermission, isAlwaysOpen, toDialableNumber, type GateFacts } from '@/lib/telephony/compliance';
import { localClock, resolveCallTimezone } from '@/lib/telephony/timezone';

/**
 * The calling gate (docs/dialer/TASKS.md D3.1–D3.2), as a pure function.
 *
 * Calling hours are 08:00 up to (not including) 17:00 in the lead's own time, every day; our own
 * do-not-call list and the lead/contact flags block; a timezone that cannot be known blocks rather
 * than guesses; and — by owner decision — calling the same number again is never blocked.
 */

/** Monday 2026-10-05 10:00 in Vietnam (UTC+7). */
const VN_10AM = new Date('2026-10-05T03:00:00Z');

function facts(overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    now: VN_10AM,
    deploymentEnabled: true,
    deploymentDryRun: false,
    settings: {
      enabled: true,
      dryRun: false,
      killedAt: null,
      callingHoursStart: 480,
      callingHoursEnd: 1020,
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      allowedCountries: ['VN', 'US', 'AU', 'SG'],
    },
    credential: { status: 'active', revokedAt: null },
    canAccessLead: true,
    rawPhone: '0948200638',
    dialCountries: ['VN'],
    suppressed: false,
    leadDoNotCall: false,
    contactDoNotCall: false,
    leadTimezone: null,
    leadCountry: 'Vietnam',
    ...overrides,
  };
}

const at = (iso: string, overrides: Partial<GateFacts> = {}) => evaluateCallPermission(facts({ now: new Date(iso), ...overrides }));

describe('evaluateCallPermission', () => {
  it('allows a Vietnamese mobile at 10:00 local, dialling it as E.164', () => {
    expect(evaluateCallPermission(facts())).toMatchObject({
      allowed: true,
      dryRun: false,
      reasons: [],
      toE164: '+84948200638',
      numberCountry: 'VN',
      timezone: { timezone: 'Asia/Ho_Chi_Minh', source: 'phone' },
      localTime: '10:00',
    });
  });

  describe('calling hours, lead-local: 08:00 inclusive to 17:00 exclusive', () => {
    it.each([
      ['2026-10-05T00:59:59Z', '07:59', false],
      ['2026-10-05T01:00:00Z', '08:00', true],
      ['2026-10-05T09:59:59Z', '16:59', true],
      ['2026-10-05T10:00:00Z', '17:00', false],
    ])('Vietnam at %s (%s local) → allowed %s', (iso, local, allowed) => {
      const decision = at(iso);
      expect(decision.localTime).toBe(local);
      expect(decision.allowed).toBe(allowed);
      expect(decision.reasons).toEqual(allowed ? [] : ['outside_hours']);
    });

    // New York is UTC-4 on 2026-10-05 (daylight time).
    it.each([
      ['2026-10-05T11:59:59Z', false],
      ['2026-10-05T12:00:00Z', true],
      ['2026-10-05T20:59:59Z', true],
      ['2026-10-05T21:00:00Z', false],
    ])('New York lead with its timezone set, at %s → allowed %s', (iso, allowed) => {
      const decision = at(iso, { rawPhone: '+14155552671', leadTimezone: 'America/New_York', leadCountry: 'United States' });
      expect(decision.timezone).toEqual({ timezone: 'America/New_York', source: 'lead' });
      expect(decision.allowed).toBe(allowed);
    });

    it('follows the lead’s clock across a daylight-saving change (New York, 2026-11-01 fall-back)', () => {
      const ny = { rawPhone: '+14155552671', leadTimezone: 'America/New_York', leadCountry: null };
      // 07:59 EST = 12:59Z after the change; the same instant a day earlier was 08:59 EDT.
      expect(at('2026-11-01T12:59:00Z', ny)).toMatchObject({ localTime: '07:59', reasons: ['outside_hours'] });
      expect(at('2026-11-01T13:00:00Z', ny)).toMatchObject({ localTime: '08:00', allowed: true });
      expect(at('2026-10-31T12:59:00Z', ny)).toMatchObject({ localTime: '08:59', allowed: true });
    });

    it('honours a team that narrows its hours', () => {
      const settings = { ...facts().settings!, callingHoursStart: 600, callingHoursEnd: 660 };
      expect(at('2026-10-05T02:59:00Z', { settings }).reasons).toEqual(['outside_hours']);
      expect(at('2026-10-05T03:00:00Z', { settings }).allowed).toBe(true);
      expect(at('2026-10-05T04:00:00Z', { settings }).reasons).toEqual(['outside_hours']);
    });

    it('blocks a weekday the team has not allowed, by the lead’s calendar', () => {
      // 2026-10-04 is a Sunday in Vietnam.
      const settings = { ...facts().settings!, allowedWeekdays: [1, 2, 3, 4, 5] };
      expect(at('2026-10-04T03:00:00Z', { settings }).reasons).toEqual(['day_not_allowed']);
      expect(at('2026-10-05T03:00:00Z', { settings }).allowed).toBe(true);
    });
  });

  describe('timezone that cannot be known blocks, never guesses', () => {
    it('blocks a US number with no lead timezone', () => {
      expect(evaluateCallPermission(facts({ rawPhone: '+14155552671', leadCountry: 'United States' })).reasons).toEqual(['tz_unknown']);
    });

    it('blocks an Australian number with no lead timezone', () => {
      expect(evaluateCallPermission(facts({ rawPhone: '+61293744000', leadCountry: 'Australia' })).reasons).toEqual(['tz_unknown']);
    });

    it('blocks a US number whose lead timezone is outside the US', () => {
      expect(evaluateCallPermission(facts({ rawPhone: '+14155552671', leadTimezone: 'Asia/Tokyo', leadCountry: null })).reasons).toEqual(['tz_unknown']);
    });

    it.each(['UTC', 'Etc/GMT+5', '+14:00', 'EST'])('refuses %s as a lead timezone: only region/city zones', (zone) => {
      expect(evaluateCallPermission(facts({ rawPhone: '+14155552671', leadTimezone: zone, leadCountry: null })).reasons).toEqual(['tz_unknown']);
    });

    it('does not read a US number on the clock of a record that says Vietnam', () => {
      expect(evaluateCallPermission(facts({ rawPhone: '+14155552671', leadCountry: 'Vietnam' })).reasons).toEqual(['tz_unknown']);
    });

    it('ignores an invalid stored timezone instead of trusting it', () => {
      expect(evaluateCallPermission(facts({ rawPhone: '+14155552671', leadTimezone: 'Mars/Olympus', leadCountry: null })).reasons).toEqual([
        'tz_unknown',
      ]);
    });
  });

  it('cannot be moved into hours by editing the lead’s timezone: a Vietnamese number keeps Vietnam’s clock', () => {
    // 21:00 in Hanoi is 03:00 the next day in Kiritimati and 03:00 in Auckland (NZDT) — both would
    // read "in hours" for a team with early hours, and 08:00+ in Kiritimati one hour later.
    const evening = '2026-10-05T14:00:00Z';
    for (const leadTimezone of ['Pacific/Kiritimati', 'Pacific/Auckland', 'America/New_York']) {
      const decision = at(evening, { leadTimezone });
      expect(decision.timezone).toEqual({ timezone: 'Asia/Ho_Chi_Minh', source: 'phone' });
      expect(decision.reasons).toEqual(['outside_hours']);
    }
  });

  it('an empty country list allows no country at all, and no settings row allows none either (fail-closed)', () => {
    const none = facts({ rawPhone: '+14155550123', dialCountries: ['US'], settings: { ...facts().settings!, allowedCountries: [] } });
    const decision = evaluateCallPermission(none);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('country_not_allowed');
    expect(evaluateCallPermission(facts({ rawPhone: '+14155550123', dialCountries: ['US'], settings: null })).allowed).toBe(false);
  });

  it('blocks premium-rate and shared-cost numbers', () => {
    expect(evaluateCallPermission(facts({ rawPhone: '19001234' })).reasons).toEqual(['number_type_not_allowed']);
    expect(evaluateCallPermission(facts({ rawPhone: '19001234', settings: { ...facts().settings!, allowedCountries: [] } })).reasons).toEqual([
      'number_type_not_allowed',
      'country_not_allowed',
    ]);
  });

  it('blocks on our own do-not-call list and on either do-not-call flag', () => {
    expect(evaluateCallPermission(facts({ suppressed: true })).reasons).toEqual(['suppressed']);
    expect(evaluateCallPermission(facts({ leadDoNotCall: true })).reasons).toEqual(['lead_do_not_call']);
    expect(evaluateCallPermission(facts({ contactDoNotCall: true })).reasons).toEqual(['contact_do_not_call']);
  });

  it('blocks a country the team has not allowed, judged by the number not the record', () => {
    const settings = { ...facts().settings!, allowedCountries: ['VN'] };
    expect(evaluateCallPermission(facts({ settings, rawPhone: '+6561234567' })).reasons).toEqual(['country_not_allowed']);
    expect(evaluateCallPermission(facts({ settings: { ...settings, allowedCountries: [] } })).reasons).toEqual(['country_not_allowed']);
  });

  it('blocks a missing or unparseable number', () => {
    // The record's country still gives a timezone, so the number is the only problem.
    expect(evaluateCallPermission(facts({ rawPhone: null })).reasons).toEqual(['no_phone']);
    expect(evaluateCallPermission(facts({ rawPhone: '   ' })).reasons).toEqual(['no_phone']);
    expect(evaluateCallPermission(facts({ rawPhone: '12345' }))).toMatchObject({ reasons: ['invalid_number'], toE164: null });
  });

  it('blocks the switches: deployment off, team off, kill switch', () => {
    expect(evaluateCallPermission(facts({ deploymentEnabled: false })).reasons).toEqual(['dialer_disabled']);
    expect(evaluateCallPermission(facts({ settings: { ...facts().settings!, enabled: false } })).reasons).toEqual(['team_disabled']);
    expect(evaluateCallPermission(facts({ settings: { ...facts().settings!, killedAt: new Date() } })).reasons).toEqual(['kill_switch']);
  });

  it('treats a team with no settings row as off, and blocks everything that needs the settings', () => {
    expect(evaluateCallPermission(facts({ settings: null })).reasons).toEqual([
      'team_disabled',
      'country_not_allowed',
      'day_not_allowed',
      'outside_hours',
    ]);
  });

  it('blocks a rep with no softphone credential, or a revoked one', () => {
    expect(evaluateCallPermission(facts({ credential: null })).reasons).toEqual(['no_credential']);
    expect(evaluateCallPermission(facts({ credential: { status: 'revoked', revokedAt: new Date() } })).reasons).toEqual(['credential_revoked']);
    expect(evaluateCallPermission(facts({ credential: { status: 'active', revokedAt: new Date() } })).reasons).toEqual(['credential_revoked']);
  });

  it('blocks a lead the rep may not access', () => {
    expect(evaluateCallPermission(facts({ canAccessLead: false })).reasons).toEqual(['lead_access_denied']);
  });

  it('returns every failing reason at once, in a fixed order', () => {
    const decision = at('2026-10-05T12:00:00Z', {
      deploymentEnabled: false,
      credential: null,
      suppressed: true,
      leadDoNotCall: true,
      contactDoNotCall: true,
    });
    expect(decision.reasons).toEqual(['dialer_disabled', 'no_credential', 'suppressed', 'lead_do_not_call', 'contact_do_not_call', 'outside_hours']);
    expect(decision.allowed).toBe(false);
  });

  it('marks dry-run from either the deployment or the team, without changing the decision', () => {
    expect(evaluateCallPermission(facts({ deploymentDryRun: true }))).toMatchObject({ allowed: true, dryRun: true });
    expect(evaluateCallPermission(facts({ settings: { ...facts().settings!, dryRun: true } }))).toMatchObject({ allowed: true, dryRun: true });
    expect(evaluateCallPermission(facts({ settings: null })).dryRun).toBe(true);
  });

  it('has no repeat-call rule: the same facts give the same answer however often they are asked', () => {
    // The gate is not given call history at all; this pins that no such input creeps in.
    const first = evaluateCallPermission(facts());
    const again = evaluateCallPermission(facts({ now: new Date(VN_10AM.getTime() + 60_000) }));
    expect([first.allowed, again.allowed]).toEqual([true, true]);
    expect(Object.keys(facts())).not.toContain('recentCalls');
  });

  it('blocks with gate_error instead of passing when deciding throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = facts({ settings: { ...facts().settings!, allowedWeekdays: null as unknown as number[] } });
    expect(evaluateCallPermission(broken)).toMatchObject({ allowed: false, dryRun: true, reasons: ['gate_error'] });
    spy.mockRestore();
  });
});

describe('resolveCallTimezone', () => {
  it('prefers the lead’s own timezone, then the number’s country, then the record’s country', () => {
    // A single-zone number decides, whatever the lead record says.
    expect(resolveCallTimezone({ leadTimezone: 'Asia/Tokyo', e164: '+6561234567', numberCountry: 'SG', country: 'Vietnam' })).toEqual({
      timezone: 'Asia/Singapore',
      source: 'phone',
    });
    // A multi-zone number uses the lead's zone when it lies in that country.
    expect(resolveCallTimezone({ leadTimezone: 'America/Chicago', e164: '+14155552671', numberCountry: 'US' })).toEqual({ timezone: 'America/Chicago', source: 'lead' });
    expect(resolveCallTimezone({ leadTimezone: 'Pacific/Honolulu', e164: '+14155552671', numberCountry: 'US' })).toEqual({ timezone: 'Pacific/Honolulu', source: 'lead' });
    expect(resolveCallTimezone({ leadTimezone: 'Australia/Perth', e164: '+61293744000', numberCountry: 'AU' })).toEqual({ timezone: 'Australia/Perth', source: 'lead' });
    expect(resolveCallTimezone({ leadTimezone: 'Australia/Perth', e164: '+14155552671', numberCountry: 'US' })).toBeNull();
    // The record's country only when it is the number's country.
    expect(resolveCallTimezone({ country: 'Vietnam' })).toEqual({ timezone: 'Asia/Ho_Chi_Minh', source: 'country' });
    expect(resolveCallTimezone({ e164: '+14155552671', numberCountry: 'US', country: 'Vietnam' })).toBeNull();
    expect(resolveCallTimezone({ e164: '+14155552671', numberCountry: 'US', country: 'United States' })).toBeNull();
    // One calling code across zones: Spain's Canary Islands run an hour behind Madrid.
    expect(resolveCallTimezone({ e164: '+34928123456', numberCountry: 'ES', country: 'Spain' })).toBeNull();
    expect(resolveCallTimezone({ leadTimezone: 'Atlantic/Canary', e164: '+34928123456', numberCountry: 'ES' })).toEqual({ timezone: 'Atlantic/Canary', source: 'lead' });
    expect(resolveCallTimezone({ leadTimezone: 'Europe/Paris', e164: '+34928123456', numberCountry: 'ES' })).toBeNull();
    expect(resolveCallTimezone({ e164: '+351296123456', numberCountry: 'PT' })).toBeNull();
    expect(resolveCallTimezone({ e164: '+6493001234', numberCountry: 'NZ', country: 'New Zealand' })).toBeNull();
    // A country the tables do not know: a region zone is accepted, nothing else.
    expect(resolveCallTimezone({ leadTimezone: 'Asia/Dhaka', e164: '+8801711000000', numberCountry: 'BD' })).toEqual({ timezone: 'Asia/Dhaka', source: 'lead' });
    for (const zone of ['UTC', 'Etc/GMT-6', 'GMT', '+06:00']) {
      expect(resolveCallTimezone({ leadTimezone: zone, e164: '+8801711000000', numberCountry: 'BD' })).toBeNull();
    }
    expect(resolveCallTimezone({})).toBeNull();
  });
});

describe('localClock', () => {
  it('reads midnight as minute 0, not hour 24', () => {
    expect(localClock(new Date('2026-10-04T17:30:00Z'), 'Asia/Ho_Chi_Minh')).toMatchObject({ minuteOfDay: 30, label: '00:30', dayOfWeek: 1 });
  });
});

describe('toDialableNumber', () => {
  it('reads a national number with the record’s country and keeps an international one as is', () => {
    expect(toDialableNumber('0948 200 638', ['VN'])).toEqual({ e164: '+84948200638', country: 'VN' });
    expect(toDialableNumber('+65 6123 4567', ['VN'])).toEqual({ e164: '+6561234567', country: 'SG' });
    expect(toDialableNumber('abc', ['VN'])).toEqual({ e164: null, country: null });
  });

  it('falls back to the next country when the record’s country cannot read the number', () => {
    expect(toDialableNumber('0948200638', ['SG', 'VN'])).toEqual({ e164: '+84948200638', country: 'VN' });
    expect(toDialableNumber('6123 4567', ['SG', 'VN'])).toEqual({ e164: '+6561234567', country: 'SG' });
    expect(toDialableNumber('0948200638', ['SG'])).toEqual({ e164: null, country: null });
  });
});

/**
 * Owner, 2026-10-08: "call any time". Hours 00:00–24:00 every day mean no clock rule, so a timezone
 * the gate cannot work out blocks nothing; every other rule (do-not-call, number checks, country,
 * switches) stays exactly as it was.
 */
describe('calling hours set to always open', () => {
  const alwaysOpen = { ...facts().settings!, callingHoursStart: 0, callingHoursEnd: 1440 };

  it('recognises only the full day on all seven days as always open', () => {
    expect(isAlwaysOpen(alwaysOpen)).toBe(true);
    expect(isAlwaysOpen({ ...alwaysOpen, callingHoursEnd: 1439 })).toBe(false);
    expect(isAlwaysOpen({ ...alwaysOpen, callingHoursStart: 1 })).toBe(false);
    expect(isAlwaysOpen({ ...alwaysOpen, allowedWeekdays: [1, 2, 3, 4, 5] })).toBe(false);
  });

  it('allows a call at 23:30 lead-local', () => {
    expect(at('2026-10-05T16:30:00Z', { settings: alwaysOpen })).toMatchObject({ allowed: true, reasons: [], localTime: '23:30' });
  });

  it('does not block a number whose timezone cannot be known', () => {
    const decision = evaluateCallPermission(facts({ rawPhone: '+14155552671', leadCountry: 'United States', settings: alwaysOpen }));
    expect(decision.reasons).toEqual([]);
    expect(decision.localTime).toBeNull();
  });

  it('keeps every other rule', () => {
    expect(evaluateCallPermission(facts({ settings: alwaysOpen, suppressed: true })).reasons).toEqual(['suppressed']);
    expect(evaluateCallPermission(facts({ settings: { ...alwaysOpen, allowedCountries: ['US'] } })).reasons).toEqual(['country_not_allowed']);
    expect(evaluateCallPermission(facts({ settings: { ...alwaysOpen, killedAt: new Date() } })).reasons).toEqual(['kill_switch']);
  });

  it('still applies the clock when the day is narrower', () => {
    const lateHours = { ...alwaysOpen, callingHoursEnd: 1380 };
    expect(at('2026-10-05T16:30:00Z', { settings: lateHours }).reasons).toEqual(['outside_hours']);
  });
});
