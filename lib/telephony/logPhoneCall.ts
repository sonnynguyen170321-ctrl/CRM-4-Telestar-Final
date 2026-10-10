import { countryNameToIso, countryOfE164, normalizePhoneIdentifier } from '@telestar/core-identity';

import { callDescription, DESCRIPTION_MAX, getPhoneOutcome, NOTES_MAX, type PhoneOutcomeId } from './outcomes';

/**
 * Logging a call the rep placed outside the CRM, from the lead drawer. One request to
 * `POST /api/telephony/phone-calls`: the server writes the `call_logged` activity, the last-contacted
 * date, the callback task, the queue tag and, for do-not-call, the lead flag and phone suppression,
 * in one transaction. Nothing is read-modify-written here, and a failure is reported, never
 * swallowed: an unflagged do-not-call lead gets called again.
 */

type CountryCode = NonNullable<ReturnType<typeof countryNameToIso>>;

export type PhoneCallTarget = { e164: string | null; country: string | null; isVietnam: boolean };

/**
 * The dialable number: read with the record's country first, then as Vietnamese — the order the
 * server-side dial loader uses (lib/telephony/compliance.ts `toDialableNumber`), so a "0948…" stored
 * on a lead whose company is in Singapore still dials.
 */
export function phoneCallTarget(raw: string | null | undefined, recordCountry?: string | null): PhoneCallTarget {
  const countries: CountryCode[] = [];
  const own = countryNameToIso(recordCountry ?? null);
  if (own) countries.push(own);
  if (!countries.includes('VN')) countries.push('VN');
  for (const country of countries) {
    const { e164 } = normalizePhoneIdentifier(raw ?? null, country);
    if (!e164) continue;
    const numberCountry = countryOfE164(e164);
    return { e164, country: numberCountry, isVietnam: numberCountry === 'VN' };
  }
  return { e164: null, country: null, isVietnam: false };
}

export type DialFlags = {
  doNotCall?: boolean | null;
  doNotCallReason?: string | null;
  tags?: readonly string[] | null;
  contact?: { doNotCall?: boolean | null } | null;
};

export type DialWarning = { block: boolean; message: string };

/**
 * What the panel says before a rep dials from their own phone. The server-side dial gate
 * (lib/telephony/compliance.ts) never sees a handset call, so a do-not-call lead is stopped here:
 * the number and the QR code are not shown. A wrong-number tag only warns — the number may have
 * been fixed since.
 */
export function dialWarning(lead: DialFlags): DialWarning | null {
  const tags = lead.tags ?? [];
  if (lead.doNotCall || lead.contact?.doNotCall || tags.includes('do_not_call')) {
    const reason = lead.doNotCallReason?.trim();
    return {
      block: true,
      message: `Do not call: this lead is on the do-not-call list${reason ? ` (${reason})` : ''}.`,
    };
  }
  if (tags.includes('wrong_number')) {
    return { block: false, message: 'This number was marked wrong number on an earlier call. Check it before dialing.' };
  }
  return null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export { callDescription, DESCRIPTION_MAX, NOTES_MAX };

export type LogPhoneCallInput = {
  lead: { id: string; firstName: string; lastName: string };
  outcome: PhoneOutcomeId;
  notes: string;
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
};

export type LoggedCall = { action: PhoneOutcomeId; outcome: PhoneOutcomeId; label: string; notes: string };

export type LogPhoneCallResult = { ok: false; error: string } | { ok: true; warnings: string[]; activity: LoggedCall };

export async function logPhoneCall(input: LogPhoneCallInput): Promise<LogPhoneCallResult> {
  const call: Fetch = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const label = getPhoneOutcome(input.outcome)?.label ?? input.outcome;
  const notes = input.notes.trim().slice(0, NOTES_MAX);
  const activity: LoggedCall = { action: input.outcome, outcome: input.outcome, label, notes };

  const response = await call('/api/telephony/phone-calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: input.lead.id, outcome: input.outcome, notes }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: false, error: (body && typeof body.error === 'string' && body.error) || 'Failed to log the call' };
  }

  const body = await response.json().catch(() => null);
  const warnings: string[] = [];
  if (input.outcome === 'do_not_call' && body && body.suppressed === false) {
    warnings.push('Call logged and the lead is flagged do-not-call, but its number could not be read, so the number was not added to the do-not-call list');
  }
  return { ok: true, warnings, activity };
}
