import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  numberInputSchema,
  settingsPatchSchema,
} from '@/lib/telephony/settingsInput';

/**
 * What a manager may write on settings/telephony. Pure: the rules live here so the route and the
 * page agree, and so a bad value is refused at the boundary with a message the manager can act on.
 */

const parse = (body: unknown) => settingsPatchSchema.safeParse(body);
const messages = (body: unknown) => {
  const result = parse(body);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('settingsPatchSchema', () => {
  it('accepts a partial patch and nothing else', () => {
    expect(parse({ enabled: true }).success).toBe(true);
    expect(parse({}).success).toBe(false); // an empty patch changes nothing: say so
    expect(parse({ tenantId: 'other' }).success).toBe(false);
    expect(parse({ enabled: true, killedAt: new Date().toISOString() }).success).toBe(false);
  });

  it('refuses Vietnam with a message that says why, in any casing', () => {
    for (const country of ['VN', 'vn', ' Vn ']) {
      expect(messages({ allowedCountries: ['SG', country] }).join(' ')).toMatch(/Vietnam.*own phone/i);
    }
  });

  it('normalizes countries to unique upper-case ISO-2 codes and refuses anything else', () => {
    const result = parse({ allowedCountries: ['sg', 'SG', 'us'] });
    expect(result.success && result.data.allowedCountries).toEqual(['SG', 'US']);
    expect(parse({ allowedCountries: ['USA'] }).success).toBe(false);
    expect(parse({ allowedCountries: ['1S'] }).success).toBe(false);
    expect(parse({ allowedCountries: [] }).success).toBe(true);
    expect(parse({ allowedCountries: Array.from({ length: 251 }, (_, i) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + (Math.floor(i / 26) % 26))) }).success).toBe(false);
  });

  it('bounds the calling hours to a real day, start before end', () => {
    expect(parse({ callingHoursStart: 0, callingHoursEnd: 1440 }).success).toBe(true);
    expect(parse({ callingHoursStart: 480, callingHoursEnd: 1020 }).success).toBe(true);
    expect(parse({ callingHoursStart: 1020, callingHoursEnd: 480 }).success).toBe(false);
    expect(parse({ callingHoursStart: 480, callingHoursEnd: 480 }).success).toBe(false);
    expect(parse({ callingHoursStart: -1, callingHoursEnd: 600 }).success).toBe(false);
    expect(parse({ callingHoursStart: 0, callingHoursEnd: 1441 }).success).toBe(false);
    expect(parse({ callingHoursStart: 1.5, callingHoursEnd: 600 }).success).toBe(false);
    expect(parse({ callingHoursStart: '480', callingHoursEnd: 600 }).success).toBe(false);
  });

  it('needs both ends of the hours together', () => {
    expect(parse({ callingHoursStart: 480 }).success).toBe(false);
    expect(parse({ callingHoursEnd: 1020 }).success).toBe(false);
  });

  it('takes weekdays 0-6, unique, at least one', () => {
    const ok = parse({ allowedWeekdays: [3, 1, 1, 5] });
    expect(ok.success && ok.data.allowedWeekdays).toEqual([1, 3, 5]);
    expect(parse({ allowedWeekdays: [] }).success).toBe(false);
    expect(parse({ allowedWeekdays: [7] }).success).toBe(false);
    expect(parse({ allowedWeekdays: [-1] }).success).toBe(false);
    expect(parse({ allowedWeekdays: ['1'] }).success).toBe(false);
  });

  it('"any time" expands to the whole day and week, and cannot be combined with narrower hours', () => {
    const result = parse({ anyTime: true });
    expect(result.success && result.data).toMatchObject({ callingHoursStart: 0, callingHoursEnd: 1440, allowedWeekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(parse({ anyTime: true, callingHoursStart: 480, callingHoursEnd: 1020 }).success).toBe(false);
    expect(parse({ anyTime: false }).success).toBe(false); // switching it off needs the hours that replace it
    expect(parse({ anyTime: false, callingHoursStart: 480, callingHoursEnd: 1020, allowedWeekdays: [1, 2, 3, 4, 5] }).success).toBe(true);
  });

  it('bounds the recording retention', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
    expect(parse({ recordingRetentionDays: MIN_RETENTION_DAYS }).success).toBe(true);
    expect(parse({ recordingRetentionDays: MAX_RETENTION_DAYS }).success).toBe(true);
    expect(parse({ recordingRetentionDays: MIN_RETENTION_DAYS - 1 }).success).toBe(false);
    expect(parse({ recordingRetentionDays: MAX_RETENTION_DAYS + 1 }).success).toBe(false);
    expect(parse({ recordingRetentionDays: 30.5 }).success).toBe(false);
    expect(parse({ recordingRetentionDays: null }).success).toBe(false);
  });

  it('accepts the kill switch only as a boolean', () => {
    expect(parse({ killed: true }).success).toBe(true);
    expect(parse({ killed: false }).success).toBe(true);
    expect(parse({ killed: 'yes' }).success).toBe(false);
  });
});

describe('numberInputSchema', () => {
  const parseNumber = (body: unknown) => numberInputSchema.safeParse(body);

  it('accepts E.164 and derives nothing from the client', () => {
    expect(parseNumber({ e164: '+14155550123' }).success).toBe(true);
    expect(parseNumber({ e164: '+65 6123 4567' }).success).toBe(false);
    expect(parseNumber({ e164: '0948200638' }).success).toBe(false);
    expect(parseNumber({ e164: '+0123456789' }).success).toBe(false);
    expect(parseNumber({ e164: '+123456' }).success).toBe(false); // too short
    expect(parseNumber({ e164: '+1234567890123456' }).success).toBe(false); // too long
    expect(parseNumber({ e164: '+1415555012x' }).success).toBe(false);
    expect(parseNumber({ e164: '+14155550123', country: 'US' }).success).toBe(false);
  });

  it('trims the label and bounds it', () => {
    const result = parseNumber({ e164: '+14155550123', label: '  Main line  ' });
    expect(result.success && result.data.label).toBe('Main line');
    expect(parseNumber({ e164: '+14155550123', label: 'x'.repeat(81) }).success).toBe(false);
  });
});
