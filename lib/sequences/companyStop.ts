import { isPublicEmailDomain } from '@telestar/core-identity';

import { prisma } from '@/lib/prisma';

import { pauseEnrollmentOccurrence } from './lifecycle';

/**
 * "Stop when someone at the same company replies" (lib/sequences/rules.ts: `stopOnCompanyReply`).
 *
 * When a lead replies — to any sequence, or to a one-off email — every sequence with the rule on
 * pauses its running cadences for the lead's colleagues, so a company that has answered does not
 * keep getting the cold sequence through three other inboxes. It does not matter whether the
 * replier was ever in that sequence: the company answered. Paused, not ended: an SDR may resume a
 * colleague once the conversation shows it is welcome.
 *
 * A colleague is a lead on the same `Account`, or with an email at the same company domain. The
 * domain half matters because many imported leads have no account yet; a public mailbox host
 * (gmail.com and the like) is never a company, so it never matches anyone.
 *
 * Only the rule's own sequences pause. A colleague's cadence in a sequence without the rule keeps
 * running: the setting belongs to the sequence that asked for it.
 *
 * The email domain is matched with a case-insensitive suffix scan within the tenant. Fine at
 * today's tenant sizes; a stored lower-cased domain column is the fix if it ever shows up slow.
 */

export const COMPANY_REPLY_REASON = 'company_reply';

export type CompanyStopResult = {
  /** Cadences moved from active to paused. */
  paused: number;
  /** The colleagues those cadences belonged to. */
  leadIds: string[];
};

function companyDomainOf(email: string | null | undefined): string | null {
  const domain = email?.split('@')[1]?.trim().toLowerCase();
  if (!domain || isPublicEmailDomain(domain)) return null;
  return domain;
}

export async function pauseCompanyCadences(input: {
  tenantId: string;
  leadId: string;
  actorUserId: string;
}): Promise<CompanyStopResult> {
  const result: CompanyStopResult = { paused: 0, leadIds: [] };

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, tenantId: input.tenantId },
    select: { accountId: true, email: true },
  });
  if (!lead) return result;

  const domain = companyDomainOf(lead.email);
  const sameCompany = [
    ...(lead.accountId ? [{ accountId: lead.accountId }] : []),
    ...(domain ? [{ email: { endsWith: `@${domain}`, mode: 'insensitive' as const } }] : []),
  ];
  if (sameCompany.length === 0) return result;

  const colleagues = await prisma.sequenceEnrollment.findMany({
    where: {
      tenantId: input.tenantId,
      sequence: { stopOnCompanyReply: true },
      status: 'active',
      leadId: { not: input.leadId },
      lead: { OR: sameCompany },
    },
    select: { id: true, leadId: true, sequenceId: true },
    orderBy: { startedAt: 'asc' },
  });

  for (const enrollment of colleagues) {
    const outcome = await pauseEnrollmentOccurrence({
      enrollmentId: enrollment.id,
      leadId: enrollment.leadId,
      sequenceId: enrollment.sequenceId,
      reason: COMPANY_REPLY_REASON,
      actorUserId: input.actorUserId,
    });
    if (outcome.ok) {
      result.paused += 1;
      if (!result.leadIds.includes(enrollment.leadId)) result.leadIds.push(enrollment.leadId);
    }
  }
  return result;
}

/**
 * The same, for callers whose own work is already done (a reply was handled, a stage was saved).
 * This rule is secondary to theirs: if it fails, the reply must not be re-processed from the top
 * by a job retry, nor a stage change refused. The failure is logged with its context and reported
 * as nothing paused.
 */
export async function pauseCompanyCadencesSafely(input: {
  tenantId: string;
  leadId: string;
  actorUserId: string;
}): Promise<CompanyStopResult> {
  try {
    return await pauseCompanyCadences(input);
  } catch (error) {
    console.error('[companyStop] could not pause colleagues after a reply', {
      tenantId: input.tenantId,
      leadId: input.leadId,
      error,
    });
    return { paused: 0, leadIds: [] };
  }
}
