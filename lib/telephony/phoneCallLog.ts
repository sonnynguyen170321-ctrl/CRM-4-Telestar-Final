import 'server-only';

import { countryNameToIso } from '@telestar/core-identity';

import type { SessionUser } from '@/lib/auth';
import { onActivityLogged } from '@/lib/contact-intelligence/events';
import { prisma } from '@/lib/prisma';

import { toDialableNumber, type DialCountry } from './compliance';
import { appendOutcomeTag, applyOutcomeEffects, callbackDueDate } from './outcomeEffects';
import { callDescription, getPhoneOutcome, type PhoneOutcomeId } from './outcomes';

/**
 * The server side of logging a call a rep placed on their own phone (docs/dialer/TASKS.md, owner
 * 2026-10-08). One transaction writes everything the call means: the `call_logged` activity, the
 * last-contacted date, the callback task, the queue tag and, for do-not-call, the lead's flag and
 * the tenant's phone suppression. The tag is appended in SQL, never read-modify-written, so a
 * concurrent tag change is not lost.
 */

/** Numbers stored without a country code are read with the record's country, then as Vietnamese. */
const FALLBACK_DIAL_COUNTRY: DialCountry = 'VN';

export class PhoneCallLeadNotFoundError extends Error {
  constructor() {
    super('Lead not found');
    this.name = 'PhoneCallLeadNotFoundError';
  }
}

export class PhoneCallForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'PhoneCallForbiddenError';
  }
}

export type LogPhoneCallParams = {
  user: SessionUser & { tenantId: string };
  leadId: string;
  outcome: PhoneOutcomeId;
  notes: string;
  now?: Date;
};

type LeadFacts = {
  id: string;
  firstName: string;
  lastName: string;
  assignedToId: string | null;
  campaignId: string | null;
  phone: string | null;
  timezone: string | null;
  contactId: string | null;
  contact: { country: string | null } | null;
  account: { country: string | null } | null;
};

function dialableE164(lead: LeadFacts): string | null {
  const own = countryNameToIso(lead.contact?.country ?? lead.account?.country ?? null) as DialCountry | null;
  const countries = [...new Set([own ?? FALLBACK_DIAL_COUNTRY, FALLBACK_DIAL_COUNTRY])];
  return toDialableNumber(lead.phone, countries).e164;
}

export async function recordPhoneCall(params: LogPhoneCallParams & { canAccess: (lead: LeadFacts) => Promise<boolean> }) {
  const { user, outcome, canAccess } = params;
  const tenantId = user.tenantId;
  const definition = getPhoneOutcome(outcome);
  if (!definition) throw new Error(`Unknown phone outcome: ${outcome}`);
  const now = params.now ?? new Date();

  const lead = await prisma.lead.findFirst({
    where: { id: params.leadId, tenantId, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      assignedToId: true,
      campaignId: true,
      phone: true,
      timezone: true,
      contactId: true,
      contact: { select: { country: true } },
      account: { select: { country: true } },
    },
  });
  if (!lead) throw new PhoneCallLeadNotFoundError();
  if (!(await canAccess(lead))) throw new PhoneCallForbiddenError();

  const e164 = definition.leadEffect === 'do_not_call' ? dialableE164(lead) : null;
  const dueDate = await callbackDueDate(outcome, lead, user.id, now);
  const metadata = { action: outcome, outcome, label: definition.label, notes: params.notes, via: 'phone' };

  const { activity, suppressed } = await prisma.$transaction(async (tx) => {
    const created = await tx.activity.create({
      data: {
        tenantId,
        userId: user.id,
        leadId: lead.id,
        type: 'call_logged',
        channel: 'phone',
        description: callDescription(definition.label, params.notes),
        metadata,
      },
    });
    const effects = await applyOutcomeEffects(tx, {
      tenantId,
      userId: user.id,
      outcome,
      lead,
      e164,
      notes: params.notes,
      dueDate,
      suppressionNote: 'logged call',
      now,
    });
    return { activity: created, suppressed: effects.suppressed };
  });

  // The activity and the do-not-call flags are committed. A failed tag must not turn this into a 500:
  // the rep would retry and log the call twice. Report it instead.
  let tagFailed = false;
  try {
    await appendOutcomeTag(tenantId, lead.id, outcome);
  } catch (error) {
    tagFailed = true;
    console.error('[telephony] call logged but the queue tag could not be written', { tenantId, leadId: lead.id, outcome, error });
  }

  await onActivityLogged({
    activityId: activity.id,
    leadId: lead.id,
    type: 'call_logged',
    channel: 'phone',
    metadata,
    userId: user.id,
    tenantId,
  });

  return { activity, suppressed, tagFailed };
}
