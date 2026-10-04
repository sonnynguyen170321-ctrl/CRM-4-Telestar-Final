import 'server-only';

import { countryNameToIso } from '@telestar/core-identity';

import { canAccessLead, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { evaluateCallPermission, toDialableNumber, type DialCountry, type GateDecision } from './compliance';
import { isTelephonyDryRun, isTelephonyEnabled } from './flags';

/**
 * Gathers what the calling gate needs for one call from the database, then asks the pure gate
 * (`compliance.ts`). Everything is read for the signed-in user's tenant only.
 *
 * The number dialled always comes from the record — the lead's phone, or the phone of the lead's own
 * contact — never from the browser, so the gate cannot be pointed at an arbitrary number.
 */

export class CallTargetNotFoundError extends Error {
  constructor() {
    super('No such lead or contact');
    this.name = 'CallTargetNotFoundError';
  }
}

/** Numbers stored without a country code are read with the record's country, then as Vietnamese. */
const FALLBACK_DIAL_COUNTRY: DialCountry = 'VN';

export type LoadedGate = {
  decision: GateDecision;
  leadId: string;
  contactId: string | null;
};

export async function loadCallGate(input: {
  user: SessionUser & { tenantId: string };
  leadId: string;
  contactId?: string | null;
  now?: Date;
}): Promise<LoadedGate> {
  const { user } = input;
  const tenantId = user.tenantId;
  const now = input.now ?? new Date();

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, tenantId, archivedAt: null },
    select: {
      id: true,
      assignedToId: true,
      campaignId: true,
      phone: true,
      timezone: true,
      doNotCall: true,
      contactId: true,
      contact: { select: { id: true, phone: true, country: true, doNotCall: true } },
      account: { select: { country: true } },
    },
  });
  if (!lead) throw new CallTargetNotFoundError();
  // Only the lead's own contact may be dialled through this lead.
  if (input.contactId && input.contactId !== lead.contactId) throw new CallTargetNotFoundError();

  const rawPhone = input.contactId ? (lead.contact?.phone ?? null) : lead.phone;
  const leadCountry = lead.contact?.country ?? lead.account?.country ?? null;
  const recordCountry = countryNameToIso(leadCountry) as DialCountry | null;
  const dialCountries = [...new Set([recordCountry ?? FALLBACK_DIAL_COUNTRY, FALLBACK_DIAL_COUNTRY])];
  const { e164 } = toDialableNumber(rawPhone, dialCountries);

  const [hasAccess, suppression, credential, settings] = await Promise.all([
    canAccessLead(user, { assignedToId: lead.assignedToId, campaignId: lead.campaignId }),
    e164 ? prisma.phoneSuppression.findFirst({ where: { tenantId, e164 }, select: { id: true } }) : Promise.resolve(null),
    prisma.telephonyCredential.findFirst({ where: { tenantId, userId: user.id }, select: { status: true, revokedAt: true } }),
    prisma.telephonySettings.findFirst({
      where: { tenantId },
      select: {
        enabled: true,
        dryRun: true,
        killedAt: true,
        callingHoursStart: true,
        callingHoursEnd: true,
        allowedWeekdays: true,
        allowedCountries: true,
      },
    }),
  ]);

  const decision = evaluateCallPermission({
    now,
    deploymentEnabled: isTelephonyEnabled(tenantId),
    deploymentDryRun: isTelephonyDryRun(tenantId),
    settings,
    credential,
    canAccessLead: hasAccess,
    rawPhone,
    dialCountries,
    suppressed: Boolean(suppression),
    leadDoNotCall: lead.doNotCall,
    contactDoNotCall: lead.contact?.doNotCall ?? false,
    leadTimezone: lead.timezone,
    leadCountry,
  });

  return { decision, leadId: lead.id, contactId: input.contactId ? lead.contactId : null };
}
