import { countryNameToIso } from '@telestar/core-identity';

import { toDialableNumber, type DialCountry } from './compliance';
import { phoneCallTarget } from './logPhoneCall';

/**
 * Who the docked dialer can call, and how the picker finds them. Client-safe and pure: the route
 * (`GET /api/telephony/targets`) reads the database and hands rows here; the dock uses the same
 * helpers to build the request and to decide whether Call is available.
 *
 * ADR-001: a number is never typed into the dialer. Every target is a lead (or the lead's own contact)
 * the rep may work, and the number dialled is read from that record on the server.
 */

export const TARGET_QUERY_MIN = 2;
export const TARGET_QUERY_MAX = 80;
export const TARGET_RESULT_LIMIT = 8;
/** Digits needed before a query is also tried as a phone number (below this it would match everything). */
const PHONE_MIN_DIGITS = 3;
const FALLBACK_DIAL_COUNTRY: DialCountry = 'VN';

export type TargetQuery = {
  /** The text as typed, trimmed. */
  text: string;
  /** Digit strings to look for in stored phone numbers; empty when the text is not number-shaped. */
  phoneNeedles: string[];
  /** Number-shaped (digits, +, spaces, brackets, dashes only): searched as a phone, never as a name. */
  phoneOnly: boolean;
};

/**
 * A search box value to a query, or null when it is too short or too long to search. A number-shaped
 * query ("+84 948 200", "(028) 123") also yields the digits, and the digits without leading zeros, so a
 * local "0948…" finds a stored "+84948…".
 */
export function parseTargetQuery(raw: string | null | undefined): TargetQuery | null {
  const text = (raw ?? '').trim();
  if (text.length < TARGET_QUERY_MIN || text.length > TARGET_QUERY_MAX) return null;
  const phoneShaped = /^[+\d(][\d\s().+-]*$/.test(text);
  const digits = text.replace(/\D/g, '');
  const needles = new Set<string>();
  if (phoneShaped) {
    // Two digits would match half the book; a number-shaped query needs at least three.
    if (digits.length < PHONE_MIN_DIGITS) return null;
    needles.add(digits);
    const trimmed = digits.replace(/^0+/, '');
    if (trimmed.length >= PHONE_MIN_DIGITS) needles.add(trimmed);
  }
  return { text, phoneNeedles: [...needles], phoneOnly: phoneShaped };
}

export function buildTargetsUrl(raw: string): string | null {
  const query = parseTargetQuery(raw);
  return query ? `/api/telephony/targets?q=${encodeURIComponent(query.text)}` : null;
}

export type DialTarget = {
  /** Stable key for lists: `leadId` or `leadId:contactId`. */
  key: string;
  leadId: string;
  /** Set when the number belongs to the lead's contact rather than the lead row. */
  contactId: string | null;
  name: string;
  company: string | null;
  /** The number the call will go to, E.164; null when the record has none that can be dialled. */
  phone: string | null;
  /** What the record holds, shown when it cannot be dialled. */
  rawPhone: string | null;
  doNotCall: boolean;
  doNotCallReason: string | null;
  /** On the tenant's phone suppression list. */
  suppressed: boolean;
  /** `lead` or `contact`: whose number it is. */
  kind: 'lead' | 'contact';
};

export type TargetLeadRow = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string | null;
  doNotCall: boolean;
  doNotCallReason: string | null;
  contactId: string | null;
  contact: { id: string; fullName: string | null; phone: string | null; country: string | null; doNotCall: boolean } | null;
  account: { country: string | null } | null;
};

const fullName = (first: string, last: string) => `${first} ${last}`.trim();

function dialCountriesFor(row: TargetLeadRow): DialCountry[] {
  const own = countryNameToIso(row.contact?.country ?? row.account?.country ?? null) as DialCountry | null;
  return [...new Set([own ?? FALLBACK_DIAL_COUNTRY, FALLBACK_DIAL_COUNTRY])];
}

/**
 * Lead rows to dial targets: the lead's own number, and the linked contact's number as a second
 * target when it is a different number. Only a contact linked to the lead appears, so a contact is
 * never reachable except through a lead the rep may work.
 */
export function toDialTargets(rows: readonly TargetLeadRow[], suppressedE164: ReadonlySet<string>): DialTarget[] {
  const targets: DialTarget[] = [];
  for (const row of rows) {
    const countries = dialCountriesFor(row);
    const lead = toDialableNumber(row.phone, countries).e164;
    if (row.phone || !row.contact?.phone) {
      targets.push({
        key: row.id,
        leadId: row.id,
        contactId: null,
        name: fullName(row.firstName, row.lastName),
        company: row.company,
        phone: lead,
        rawPhone: row.phone,
        doNotCall: row.doNotCall,
        doNotCallReason: row.doNotCallReason,
        suppressed: lead ? suppressedE164.has(lead) : false,
        kind: 'lead',
      });
    }
    const contactPhone = row.contact?.phone ?? null;
    if (!row.contact || !row.contactId || !contactPhone) continue;
    const contact = toDialableNumber(contactPhone, countries).e164;
    if (contact && contact === lead) continue;
    targets.push({
      key: `${row.id}:${row.contact.id}`,
      leadId: row.id,
      contactId: row.contact.id,
      name: row.contact.fullName?.trim() || fullName(row.firstName, row.lastName),
      company: row.company,
      phone: contact,
      rawPhone: contactPhone,
      doNotCall: row.contact.doNotCall,
      doNotCallReason: null,
      suppressed: contact ? suppressedE164.has(contact) : false,
      kind: 'contact',
    });
  }
  return targets;
}

export type TargetWarning = { block: boolean; message: string };

/** What the dock says about a picked target before Call; the server gate still decides. */
export function targetWarning(target: Pick<DialTarget, 'phone' | 'doNotCall' | 'doNotCallReason' | 'suppressed'>): TargetWarning | null {
  if (target.doNotCall) {
    const reason = target.doNotCallReason?.trim();
    return { block: true, message: `Do not call: this contact is on the do-not-call list${reason ? ` (${reason})` : ''}.` };
  }
  if (target.suppressed) return { block: true, message: 'Do not call: this number is on the company do-not-call list.' };
  if (!target.phone) return { block: true, message: 'This record has no number that can be called. Add one on the lead first.' };
  return null;
}

export type CallerIdOption = { id: string; e164: string; label: string | null; country: string; isDefault: boolean; isOverallDefault: boolean };

/** The empty value means "Automatic": the server picks by the destination country. */
export const AUTOMATIC_CALLER_ID = '';

export function callerIdLabel(option: Pick<CallerIdOption, 'e164' | 'label' | 'country'>): string {
  return `${option.label?.trim() || option.country} ${option.e164}`.trim();
}

/** Drop a chosen caller ID that is no longer in the list (a number was switched off) back to Automatic. */
export function resolveCallerChoice(choice: string, options: readonly Pick<CallerIdOption, 'id'>[]): string {
  return choice && options.some((o) => o.id === choice) ? choice : AUTOMATIC_CALLER_ID;
}

/** Keeps the newest search's answer: a slow earlier answer must not overwrite a later one. */
export function createLatestOnly() {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (token: number) => token === latest,
  };
}

/** The lead drawer's lead as a dock target, so its Call button opens the dock with this lead preselected. */
export function targetFromLead(lead: {
  id: string;
  firstName: string;
  lastName: string;
  company?: string | null;
  phone?: string | null;
  doNotCall?: boolean | null;
  doNotCallReason?: string | null;
  tags?: readonly string[] | null;
  contact?: { country?: string | null; doNotCall?: boolean | null } | null;
}): DialTarget {
  const dialable = phoneCallTarget(lead.phone, lead.contact?.country).e164;
  return {
    key: lead.id,
    leadId: lead.id,
    contactId: null,
    name: fullName(lead.firstName, lead.lastName),
    company: lead.company ?? null,
    phone: dialable,
    rawPhone: lead.phone ?? null,
    doNotCall: Boolean(lead.doNotCall || lead.contact?.doNotCall || lead.tags?.includes('do_not_call')),
    doNotCallReason: lead.doNotCallReason ?? null,
    suppressed: false,
    kind: 'lead',
  };
}
