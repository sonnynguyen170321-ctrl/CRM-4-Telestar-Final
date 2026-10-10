import 'server-only';

import { countryNameToIso } from '@telestar/core-identity';

import type { SessionUser } from '@/lib/auth';
import { onActivityLogged } from '@/lib/contact-intelligence/events';
import { nextBusinessDay } from '@/lib/dates/businessDays';
import { businessTimezoneFor } from '@/lib/dates/businessTimezone';
import { prisma } from '@/lib/prisma';

import { toDialableNumber, type DialCountry } from './compliance';
import { callDescription, getPhoneOutcome, outcomeLeadTag, type PhoneOutcomeId } from './outcomes';

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

  const tag = outcomeLeadTag(outcome);
  const e164 = definition.leadEffect === 'do_not_call' ? dialableE164(lead) : null;
  const dueDate =
    definition.leadEffect === 'callback'
      ? nextBusinessDay(now, await businessTimezoneFor({ leadTimezone: lead.timezone, assigneeId: lead.assignedToId ?? user.id }))
      : null;
  const reason = params.notes ? `Logged on a call: ${params.notes}`.slice(0, 500) : 'Logged on a call';
  const metadata = { action: outcome, outcome, label: definition.label, notes: params.notes, via: 'phone' };

  const activity = await prisma.$transaction(async (tx) => {
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

    await tx.lead.updateMany({ where: { id: lead.id, tenantId }, data: { lastContactedAt: now } });

    if (definition.leadEffect === 'do_not_call') {
      // Only the first do-not-call sets the date and reason, so a repeat does not rewrite history.
      await tx.lead.updateMany({
        where: { id: lead.id, tenantId, doNotCall: false },
        data: {
          doNotCall: true,
          doNotCallAt: now,
          doNotCallReason: reason,
        },
      });
      if (lead.contactId) {
        await tx.contact.updateMany({
          where: { id: lead.contactId, tenantId, doNotCall: false },
          data: { doNotCall: true, doNotCallAt: now, doNotCallReason: reason },
        });
      }
      if (e164) {
        await tx.phoneSuppression.upsert({
          where: { tenantId_e164: { tenantId, e164 } },
          create: { tenantId, e164, source: 'call_outcome', reason: `Lead ${lead.id}, logged call`, createdById: user.id },
          update: {},
        });
      }
    }

    if (tag) {
      // Appended in SQL (array_append), and only when absent: a concurrent tag change is not lost.
      await tx.lead.updateMany({
        where: { id: lead.id, tenantId, NOT: { tags: { has: tag } } },
        data: { tags: { push: tag } },
      });
    }

    if (dueDate) {
      await tx.task.create({
        data: {
          tenantId,
          leadId: lead.id,
          userId: lead.assignedToId ?? user.id,
          type: 'phone',
          title: `Callback: ${lead.firstName} ${lead.lastName}`,
          description: 'Callback requested on previous call',
          dueDate,
          priority: 'high',
        },
      });
    }

    return created;
  });

  await onActivityLogged({
    activityId: activity.id,
    leadId: lead.id,
    type: 'call_logged',
    channel: 'phone',
    metadata,
    userId: user.id,
    tenantId,
  });

  return { activity, suppressed: Boolean(e164) };
}
