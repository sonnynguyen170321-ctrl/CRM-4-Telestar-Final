import 'server-only';

import type { Prisma } from '@prisma/client';

import { nextBusinessDay } from '@/lib/dates/businessDays';
import { businessTimezoneFor } from '@/lib/dates/businessTimezone';
import { prisma, withTenantRaw } from '@/lib/prisma';

import { getPhoneOutcome, outcomeLeadTag, type PhoneOutcomeId } from './outcomes';

/**
 * What a call outcome does to the lead, shared by the two doors that record one: a call logged from
 * the lead drawer (phoneCallLog.ts) and the softphone's wrap-up (the call outcome route). One place,
 * so a do-not-call outcome means the same thing wherever it is chosen: the lead and contact are
 * flagged, the number goes on the tenant's phone suppression list (the dial gate's `suppressed`
 * rule), and the lead leaves the calling queue by tag. The tag (`appendOutcomeTag`) is appended in
 * SQL after the transaction, never read-modify-written, so a concurrent tag change is not lost.
 */

export type OutcomeLead = {
  id: string;
  firstName: string;
  lastName: string;
  assignedToId: string | null;
  contactId: string | null;
  timezone: string | null;
};

/** The callback task's due date; computed before the transaction so no query runs inside it for it. */
export async function callbackDueDate(outcome: PhoneOutcomeId, lead: OutcomeLead, fallbackUserId: string, now: Date): Promise<Date | null> {
  if (getPhoneOutcome(outcome)?.leadEffect !== 'callback') return null;
  return nextBusinessDay(now, await businessTimezoneFor({ leadTimezone: lead.timezone, assigneeId: lead.assignedToId ?? fallbackUserId }));
}

/** The callback task's description carries the call id: that is how a re-label finds the task it made. */
export const callbackDescription = (callId: string) => `Callback requested on previous call (call ${callId})`;

/** Whether this call already produced a callback task for the lead, open or done. */
export async function callbackTaskExists(tenantId: string, leadId: string, callId: string): Promise<boolean> {
  const found = await prisma.task.findFirst({
    where: { tenantId, leadId, type: 'phone', description: callbackDescription(callId) },
    select: { id: true },
  });
  return found !== null;
}

export type ApplyOutcomeEffectsInput = {
  tenantId: string;
  userId: string;
  outcome: PhoneOutcomeId;
  lead: OutcomeLead;
  /** The number to put on the suppression list for do-not-call; null when it could not be read. */
  e164: string | null;
  notes: string;
  /** Required when the outcome is a callback request; see `callbackDueDate`. */
  dueDate: Date | null;
  /** Where the suppression came from, for the audit trail ("logged call", "softphone call <id>"). */
  suppressionNote: string;
  /** False on a re-label of a call that already has an outcome: the last-contacted date moves once. */
  firstWrite?: boolean;
  /** Marks the callback task with the call it came from, so it can be found again (see `callbackTaskExists`). */
  callId?: string;
  now: Date;
};

/** Returns whether a number was added to the suppression list (do-not-call with a readable number). */
export async function applyOutcomeEffects(tx: Prisma.TransactionClient, input: ApplyOutcomeEffectsInput): Promise<{ suppressed: boolean }> {
  const { tenantId, userId, outcome, lead, e164, now } = input;
  const definition = getPhoneOutcome(outcome);
  if (!definition) throw new Error(`Unknown phone outcome: ${outcome}`);

  if (input.firstWrite !== false) {
    await tx.lead.updateMany({ where: { id: lead.id, tenantId }, data: { lastContactedAt: now } });
  }

  let suppressed = false;
  if (definition.leadEffect === 'do_not_call') {
    const reason = input.notes ? `Logged on a call: ${input.notes}`.slice(0, 500) : 'Logged on a call';
    // Only the first do-not-call sets the date and reason, so a repeat does not rewrite history.
    await tx.lead.updateMany({
      where: { id: lead.id, tenantId, doNotCall: false },
      data: { doNotCall: true, doNotCallAt: now, doNotCallReason: reason },
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
        create: { tenantId, e164, source: 'call_outcome', reason: `Lead ${lead.id}, ${input.suppressionNote}`, createdById: userId },
        update: {},
      });
      suppressed = true;
    }
  }

  if (input.dueDate) {
    await tx.task.create({
      data: {
        tenantId,
        leadId: lead.id,
        userId: lead.assignedToId ?? userId,
        type: 'phone',
        title: `Callback: ${lead.firstName} ${lead.lastName}`,
        description: input.callId ? `${callbackDescription(input.callId)}` : 'Callback requested on previous call',
        dueDate: input.dueDate,
        priority: 'high',
      },
    });
  }

  return { suppressed };
}

/**
 * Puts the outcome's queue tag (do_not_call, wrong_number) on the lead, if the outcome has one.
 *
 * Raw SQL, through `withTenantRaw` so it carries the tenant on its own connection (raw SQL is outside
 * the tenant extension, and inside an interactive transaction it would run with no tenant set and
 * touch nothing under RLS). Raw because `Lead.tags` is a nullable array: a lead created without tags
 * has NULL, and neither Prisma's `push` nor `NOT has` matches NULL, so the tag would silently never
 * be written. Idempotent: a tag already present is not added twice.
 */
export async function appendOutcomeTag(tenantId: string, leadId: string, outcome: PhoneOutcomeId): Promise<void> {
  const tag = outcomeLeadTag(outcome);
  if (!tag) return;
  await withTenantRaw(
    tenantId,
    (db) => db.$executeRaw`
      UPDATE "Lead"
      SET "tags" = array_append(COALESCE("tags", ARRAY[]::text[]), ${tag})
      WHERE "id" = ${leadId} AND "tenantId" = ${tenantId} AND NOT (${tag} = ANY(COALESCE("tags", ARRAY[]::text[])))`
  );
}
