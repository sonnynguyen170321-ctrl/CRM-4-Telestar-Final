import { countryNameToIso, countryOfE164, normalizePhoneIdentifier } from '@telestar/core-identity';

import { outcomeLeadTag, PHONE_OUTCOMES, type PhoneOutcomeId } from './phoneOutcomes';

/**
 * Logging a call the rep placed outside the CRM, from the lead drawer. Client-side, and the same
 * effects the dashboard's task Call Logging modal has (app/page.tsx `handleLoggingSubmit`): the
 * `call_logged` activity, a callback task for tomorrow 09:00, and a `do_not_call` / `wrong_number`
 * tag so the lead leaves the calling queue. Every effect that fails is reported, never swallowed:
 * an untagged do-not-call lead gets called again.
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

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LogPhoneCallInput = {
  lead: { id: string; firstName: string; lastName: string; tags?: string[] | null };
  outcome: PhoneOutcomeId;
  notes: string;
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
  now?: Date;
};

export type LogPhoneCallResult =
  | { ok: false; error: string }
  | { ok: true; warnings: string[]; activity: { action: PhoneOutcomeId; outcome: string; notes: string } };

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function errorText(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && typeof body.error === 'string' && body.error) || fallback;
}

export async function logPhoneCall(input: LogPhoneCallInput): Promise<LogPhoneCallResult> {
  const call: Fetch = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const label = PHONE_OUTCOMES.find((o) => o.id === input.outcome)?.label ?? input.outcome;
  const notes = input.notes.trim();
  const activity = { action: input.outcome, outcome: label, notes };

  const logged = await call('/api/activities', json({
    leadId: input.lead.id,
    type: 'call_logged',
    channel: 'phone',
    description: `Call logged. Outcome: ${label}${notes ? `: ${notes}` : ''}`,
    metadata: { ...activity, via: 'phone' },
  }));
  if (!logged.ok) return { ok: false, error: await errorText(logged, 'Failed to log the call') };

  const warnings: string[] = [];

  if (input.outcome === 'callback_requested') {
    const due = new Date(input.now ?? new Date());
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
    const task = await call('/api/tasks', json({
      leadId: input.lead.id,
      type: 'phone',
      title: `Callback — ${input.lead.firstName} ${input.lead.lastName}`,
      description: 'Callback requested',
      dueDate: due.toISOString(),
      priority: 'high',
    }));
    if (!task.ok) warnings.push('Call logged, but the callback task could not be created — add it by hand');
  }

  const tag = outcomeLeadTag(input.outcome);
  const tags = input.lead.tags ?? [];
  if (tag && !tags.includes(tag)) {
    const tagged = await call(`/api/leads/${input.lead.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [...tags, tag] }),
    });
    if (!tagged.ok) warnings.push(`Call logged, but the "${tag}" tag did not save — set it on the lead`);
  }

  return { ok: true, warnings, activity };
}
