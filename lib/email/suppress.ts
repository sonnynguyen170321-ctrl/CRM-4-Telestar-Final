/**
 * The one door out of the sending pool.
 *
 * Before this existed, an address could only be suppressed by an NDR arriving back in the inbox
 * and matching a subject regex (`workers/sync.ts`). Production ran for a month on that path and
 * wrote **zero** `SuppressionEntry` rows across 384 sends, 20 unresolved messages and 7 outright
 * SMTP refusals — while `Lead.emailInvalid` stayed false on all 1,138 leads. The guard in front
 * of every send worked perfectly; nothing ever put anything behind it.
 *
 * So every way of learning that an address is dead now ends here:
 *
 *   - the provider refuses the recipient during the send  (`workers/email.ts`)
 *   - a bounce notification arrives in the inbox          (`workers/sync.ts`)
 *   - a person unsubscribes or is suppressed by hand      (existing routes)
 *
 * What it does, in one transaction, all of it idempotent:
 *
 *   1. `SuppressionEntry` with `campaignId: null` — the 2026-09-23 decision is tenant-wide, so a
 *      second campaign cannot write to an address the first one killed
 *   2. `Lead.emailInvalid` and an `invalid-email` tag, which is what the UI and the AI surfaces
 *      already read
 *   3. the cadence pauses with a reason a human can act on, rather than stalling
 *   4. an activity row, so the lead's timeline says why it went quiet
 *
 * Suppression is never undone here. Reviving an address is a deliberate human act, and giving
 * this module an "unsuppress" would make it the thing that silently lets a dead address back in.
 */
import { prisma } from '@/lib/prisma';
import { pauseEnrollmentOccurrence } from '@/lib/sequences/lifecycle';

export type SuppressionReason = 'hard_bounce' | 'soft_bounce' | 'spam' | 'manual' | 'unsubscribed';

export interface SuppressRecipientInput {
  tenantId: string;
  /** Normalised to lowercase; the unique index is on the stored form. */
  email: string;
  /** Present for a send; absent when a bounce cannot be traced back to a lead. */
  leadId?: string | null;
  reason: SuppressionReason;
  /** Free text for the activity row — the provider's own words where we have them. */
  detail?: string;
  /** Whose authority this acts under. Falls back to the lead's assignee. */
  actorUserId?: string | null;
  /**
   * False when the caller already wrote the timeline entry.
   *
   * `workers/sync.ts` records the bounce against the provider's message id, which de-duplicates
   * a redelivered webhook properly and carries more detail than this module has. Writing one
   * here as well put two `email_bounced` rows on the lead for a single bounce.
   */
  recordActivity?: boolean;
}

export interface SuppressRecipientResult {
  suppressed: boolean;
  /** False when the address was already on the list — the caller usually has nothing to do. */
  newlySuppressed: boolean;
}

/**
 * Stop writing to this address, tenant-wide, and stop the cadence behind it.
 *
 * Never throws. A send that has already been refused must not fail its job a second time
 * because the bookkeeping failed; the message is not with the prospect either way, and a
 * suppression that did not get written is recoverable by the next bounce.
 */
export async function suppressRecipient(
  input: SuppressRecipientInput
): Promise<SuppressRecipientResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { suppressed: false, newlySuppressed: false };

  try {
    // `campaignId: null` is the tenant-wide form the schema's unique index already allows.
    // Scoping to one campaign was the alternative and is exactly how a dead address gets
    // written to again by the next campaign.
    const existing = await prisma.suppressionEntry.findFirst({
      where: { tenantId: input.tenantId, email, campaignId: null },
      select: { id: true },
    });

    if (!existing) {
      await prisma.suppressionEntry.create({
        data: { tenantId: input.tenantId, email, campaignId: null, reason: input.reason },
      });
    }

    const lead = input.leadId
      ? await prisma.lead.findUnique({
          where: { id: input.leadId },
          select: { id: true, tenantId: true, assignedToId: true, emailInvalid: true, tags: true },
        })
      : null;

    if (lead && lead.tenantId === input.tenantId) {
      const actorUserId = input.actorUserId ?? lead.assignedToId;

      if (!lead.emailInvalid) {
        const tags = (lead.tags as string[] | undefined) ?? [];
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            emailInvalid: true,
            ...(tags.includes('invalid-email') ? {} : { tags: { push: 'invalid-email' } }),
          },
        });

        if (input.recordActivity !== false) {
          await prisma.activity.create({
            data: {
              userId: actorUserId,
              leadId: lead.id,
              type: 'email_bounced',
              channel: 'email',
              description: `Suppressed ${email}: ${input.detail ?? input.reason}`,
              metadata: { reason: input.reason, detail: input.detail ?? null, auto: true },
            },
          });
        }
      }

      // A suppressed address with a running cadence would keep producing steps that can only
      // be refused. Pausing names the reason on the enrollment, which is what the operator
      // console reads.
      const enrollment = await prisma.sequenceEnrollment.findFirst({
        where: { leadId: lead.id, status: 'active' },
        select: { id: true, sequenceId: true },
      });
      if (enrollment) {
        await pauseEnrollmentOccurrence({
          enrollmentId: enrollment.id,
          leadId: lead.id,
          sequenceId: enrollment.sequenceId,
          reason: input.reason === 'soft_bounce' ? 'soft_bounce' : 'hard_bounce',
          actorUserId,
        });
      }
    }

    return { suppressed: true, newlySuppressed: !existing };
  } catch (err) {
    console.error(`[suppress] could not suppress ${email}:`, err);
    return { suppressed: false, newlySuppressed: false };
  }
}
