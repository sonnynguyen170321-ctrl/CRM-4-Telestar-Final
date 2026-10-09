import { countryNameToIso, countryOfE164, normalizePhoneIdentifier } from '@telestar/core-identity';

import { outcomeLeadTag, PHONE_OUTCOMES, type PhoneOutcomeId } from './phoneOutcomes';

/**
 * Logging a call the rep placed outside the CRM, from the lead drawer. Client-side, with the effects
 * a logged call has elsewhere: the `call_logged` activity (whose route creates the callback task for
 * "Call Back Requested"), the lead's last-contacted date, and a `do_not_call` / `wrong_number` tag
 * so the lead leaves the calling queue. Every effect that fails is reported, never swallowed: an
 * untagged do-not-call lead gets called again.
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

/** Room `description` leaves for the notes: activities cap it at 500 (lib/validation/core.ts). */
export const DESCRIPTION_MAX = 500;
/** What the panel lets a rep type; the full text is kept in `metadata.notes`. */
export const NOTES_MAX = 2000;

export type LogPhoneCallInput = {
  lead: { id: string; firstName: string; lastName: string };
  outcome: PhoneOutcomeId;
  notes: string;
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
  now?: Date;
};

export type LoggedCall = { action: PhoneOutcomeId; outcome: PhoneOutcomeId; label: string; notes: string };

export type LogPhoneCallResult = { ok: false; error: string } | { ok: true; warnings: string[]; activity: LoggedCall };

const json = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function errorText(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && typeof body.error === 'string' && body.error) || fallback;
}

/** "Call logged. Outcome: …: notes", shortened to fit; the notes themselves are never cut. */
export function callDescription(label: string, notes: string): string {
  const head = `Call logged. Outcome: ${label}`;
  if (!notes) return head;
  const full = `${head}: ${notes}`;
  return full.length <= DESCRIPTION_MAX ? full : `${full.slice(0, DESCRIPTION_MAX - 1)}…`;
}

/**
 * Metadata in the shape the task path writes (`outcome` is the id), so reports read one shape, and
 * so `POST /api/activities` creates the callback task itself — on the next business day in the
 * lead's timezone — exactly as it does for a call logged anywhere else.
 */
export async function logPhoneCall(input: LogPhoneCallInput): Promise<LogPhoneCallResult> {
  const call: Fetch = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const label = PHONE_OUTCOMES.find((o) => o.id === input.outcome)?.label ?? input.outcome;
  const notes = input.notes.trim().slice(0, NOTES_MAX);
  const activity: LoggedCall = { action: input.outcome, outcome: input.outcome, label, notes };

  const logged = await call('/api/activities', json('POST', {
    leadId: input.lead.id,
    type: 'call_logged',
    channel: 'phone',
    description: callDescription(label, notes),
    metadata: { ...activity, via: 'phone' },
  }));
  if (!logged.ok) return { ok: false, error: await errorText(logged, 'Failed to log the call') };

  const warnings: string[] = [];

  // A call is contact, as a completed phone task records it (app/api/tasks/[id]). The tag is added
  // to the lead's tags as they are now, read fresh: the drawer's copy can be stale, and the lead
  // API replaces the whole list — an old copy would drop a tag set since.
  const tag = outcomeLeadTag(input.outcome);
  const update: { lastContactedAt: string; tags?: string[] } = { lastContactedAt: (input.now ?? new Date()).toISOString() };
  if (tag) {
    const current = await call(`/api/leads/${input.lead.id}`);
    const fresh = current.ok ? await current.json().catch(() => null) : null;
    if (fresh && Array.isArray(fresh.tags)) {
      if (!fresh.tags.includes(tag)) update.tags = [...fresh.tags, tag];
    } else {
      warnings.push(`Call logged, but the "${tag}" tag could not be added — set it on the lead`);
    }
  }

  const saved = await call(`/api/leads/${input.lead.id}`, json('PUT', update));
  if (!saved.ok) {
    warnings.push(
      update.tags
        ? `Call logged, but the "${tag}" tag did not save — set it on the lead`
        : 'Call logged, but the lead’s last-contacted date did not update'
    );
  }

  return { ok: true, warnings, activity };
}
