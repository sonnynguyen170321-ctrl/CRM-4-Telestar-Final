import { countryOfE164, normalizePhoneIdentifier } from '@telestar/core-identity';
import { phoneLineType } from '@telestar/core-identity/phone-type';

import { localClock, resolveCallTimezone, type CallTimezone } from './timezone';

/**
 * The calling gate (docs/dialer/TASKS.md D3.1) — the only place that decides whether a call may be
 * placed. Pure: the loader in `gate.ts` gathers the facts, this decides.
 *
 * It runs twice per call: when the rep asks (`POST /api/telephony/calls`), and again when the
 * provider reports the parked call (`call.initiated`, Phase 4), because a call authorized at 16:59:59
 * must not connect at 17:00 and a number suppressed in between must not ring. The second run is not
 * optional.
 *
 * Every rule is checked and every failing reason is returned, in a fixed order, so the rep sees all
 * of what stands in the way at once instead of fixing one thing to discover the next. Anything that
 * throws while deciding is a block (`gate_error`), never a pass.
 *
 * There is deliberately no "one call per number per day" rule (owner decision, 2026-10-04): a rep
 * may call the same number again as often as the work needs, within calling hours.
 */

export type DialCountry = NonNullable<Parameters<typeof normalizePhoneIdentifier>[1]>;

export const BLOCK_REASONS = [
  'dialer_disabled',
  'team_disabled',
  'kill_switch',
  'no_credential',
  'credential_revoked',
  'lead_access_denied',
  'no_phone',
  'invalid_number',
  'number_type_not_allowed',
  'country_not_allowed',
  'suppressed',
  'lead_do_not_call',
  'contact_do_not_call',
  'tz_unknown',
  'day_not_allowed',
  'outside_hours',
  'gate_error',
] as const;

export type BlockReason = (typeof BLOCK_REASONS)[number];

/** Lines the dialer never calls: the caller pays a premium or shares the cost. */
const BLOCKED_LINE_TYPES = new Set(['PREMIUM_RATE', 'SHARED_COST']);

export type GateSettings = {
  enabled: boolean;
  dryRun: boolean;
  killedAt: Date | null;
  /** Minutes since local midnight; a call is allowed from `start` up to, not including, `end`. */
  callingHoursStart: number;
  callingHoursEnd: number;
  allowedWeekdays: number[];
  /** ISO 3166 alpha-2. */
  allowedCountries: string[];
};

export type GateFacts = {
  now: Date;
  /** Deployment switch (`isTelephonyEnabled`). */
  deploymentEnabled: boolean;
  /** Deployment dry-run (`isTelephonyDryRun`). */
  deploymentDryRun: boolean;
  /** The tenant's settings row; null when the team has never turned the dialer on. */
  settings: GateSettings | null;
  credential: { status: string; revokedAt: Date | null } | null;
  canAccessLead: boolean;
  /** The number as stored on the record being called. */
  rawPhone: string | null;
  /** Countries tried in order to read a national number ("0948…"), alpha-2. */
  dialCountries: DialCountry[];
  /** Whether the dialled number is on the tenant's do-not-call list (looked up by the loader). */
  suppressed: boolean;
  leadDoNotCall: boolean;
  contactDoNotCall: boolean;
  leadTimezone: string | null;
  /** The lead's country as recorded (name or code), for the timezone fallback. */
  leadCountry: string | null;
};

export type GateDecision = {
  /** True only when no rule blocks. Dry-run does not change this; see `dryRun`. */
  allowed: boolean;
  /** Dry-run: the decision is recorded, no call is placed. */
  dryRun: boolean;
  reasons: BlockReason[];
  toE164: string | null;
  /** Country of the dialled number, alpha-2. */
  numberCountry: string | null;
  timezone: CallTimezone | null;
  /** Lead-local time when the gate ran, "HH:MM". */
  localTime: string | null;
  evaluatedAt: string;
};

/**
 * The dialable form of a stored number, shared with the loader so both use the same E.164. A
 * national number is read with each country in turn — the record's own first, then the fallback —
 * so a Vietnamese "0948…" stored on a lead whose company is in Singapore is still dialable.
 */
export function toDialableNumber(raw: string | null, dialCountries: DialCountry[]): { e164: string | null; country: string | null } {
  for (const country of dialCountries) {
    const { e164 } = normalizePhoneIdentifier(raw, country);
    if (e164) return { e164, country: countryOfE164(e164) };
  }
  return { e164: null, country: null };
}

export const MINUTES_PER_DAY = 1440;

/**
 * Calling hours that cover every minute of every weekday: the owner's "call any time" setting
 * (2026-10-08). Start 0, end 1440, all seven days. Anything narrower keeps the clock rules.
 */
export function isAlwaysOpen(settings: Pick<GateSettings, 'callingHoursStart' | 'callingHoursEnd' | 'allowedWeekdays'>): boolean {
  return (
    settings.callingHoursStart <= 0 &&
    settings.callingHoursEnd >= MINUTES_PER_DAY &&
    [0, 1, 2, 3, 4, 5, 6].every((day) => settings.allowedWeekdays.includes(day))
  );
}

function decide(facts: GateFacts): GateDecision {
  const reasons: BlockReason[] = [];
  const { settings } = facts;

  if (!facts.deploymentEnabled) reasons.push('dialer_disabled');
  if (!settings?.enabled) reasons.push('team_disabled');
  if (settings?.killedAt) reasons.push('kill_switch');

  if (!facts.credential) reasons.push('no_credential');
  else if (facts.credential.status !== 'active' || facts.credential.revokedAt) reasons.push('credential_revoked');

  if (!facts.canAccessLead) reasons.push('lead_access_denied');

  const number = facts.rawPhone?.trim() ? toDialableNumber(facts.rawPhone, facts.dialCountries) : null;
  if (!number) reasons.push('no_phone');
  else if (!number.e164) reasons.push('invalid_number');
  else {
    if (BLOCKED_LINE_TYPES.has(phoneLineType(number.e164) ?? '')) reasons.push('number_type_not_allowed');
    if (!number.country || !(settings?.allowedCountries ?? []).includes(number.country)) reasons.push('country_not_allowed');
  }

  if (facts.suppressed) reasons.push('suppressed');
  if (facts.leadDoNotCall) reasons.push('lead_do_not_call');
  if (facts.contactDoNotCall) reasons.push('contact_do_not_call');

  const timezone = resolveCallTimezone({
    leadTimezone: facts.leadTimezone,
    e164: number?.e164,
    numberCountry: number?.country,
    country: facts.leadCountry,
  });
  let localTime: string | null = null;
  // A team that allows every minute of every day needs no clock, so an unknown timezone blocks
  // nothing there; the local time is still recorded when it is known.
  if (settings && isAlwaysOpen(settings)) {
    if (timezone) localTime = localClock(facts.now, timezone.timezone).label;
  } else if (!timezone) {
    reasons.push('tz_unknown');
  } else {
    const clock = localClock(facts.now, timezone.timezone);
    localTime = clock.label;
    if (!settings || !settings.allowedWeekdays.includes(clock.dayOfWeek)) reasons.push('day_not_allowed');
    if (!settings || clock.minuteOfDay < settings.callingHoursStart || clock.minuteOfDay >= settings.callingHoursEnd) {
      reasons.push('outside_hours');
    }
  }

  return {
    allowed: reasons.length === 0,
    dryRun: facts.deploymentDryRun || settings?.dryRun !== false,
    reasons,
    toE164: number?.e164 ?? null,
    numberCountry: number?.country ?? null,
    timezone,
    localTime,
    evaluatedAt: facts.now.toISOString(),
  };
}

export function evaluateCallPermission(facts: GateFacts): GateDecision {
  try {
    return decide(facts);
  } catch (error) {
    console.error('[telephony] calling gate failed; blocking the call', { error });
    return {
      allowed: false,
      dryRun: true,
      reasons: ['gate_error'],
      toE164: null,
      numberCountry: null,
      timezone: null,
      localTime: null,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
