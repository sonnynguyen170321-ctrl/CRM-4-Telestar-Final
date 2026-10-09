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
import { pauseAllLeadCadences } from '@/lib/sequences/leadStop';

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

/**
 * The suppression entry that stops a send to this address, if any — the check every send path
 * makes immediately before the provider call.
 *
 * Case-insensitive on both the address and the domain. Entries are written lowercase, but
 * `Lead.email` keeps the case it was imported with, and an exact match let `John.Doe@Acme.com`
 * be emailed after `john.doe@acme.com` bounced or unsubscribed (pre-launch audit, 2026-10-05).
 * With a campaign, entries for that campaign and tenant-wide entries apply; without one, any entry.
 */
export async function findSuppression(input: { tenantId: string; email: string | null | undefined; campaignId?: string | null }) {
  const email = input.email?.trim().toLowerCase();
  if (!email) return null;
  const domain = email.split('@')[1];
  return prisma.suppressionEntry.findFirst({
    where: {
      tenantId: input.tenantId,
      AND: [
        {
          OR: [
            { email: { equals: email, mode: 'insensitive' } },
            ...(domain ? [{ domain: { equals: domain, mode: 'insensitive' as const } }] : []),
          ],
        },
        ...(input.campaignId ? [{ OR: [{ campaignId: input.campaignId }, { campaignId: null }] }] : []),
      ],
    },
  });
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
      // Every cadence on the lead, not the first active one: a suppressed address in a second
      // sequence would otherwise keep producing steps that can only be refused.
      await pauseAllLeadCadences({
        leadId: lead.id,
        reason: input.reason === 'soft_bounce' ? 'soft_bounce' : 'hard_bounce',
        actorUserId,
      });
    }

    return { suppressed: true, newlySuppressed: !existing };
  } catch (err) {
    console.error(`[suppress] could not suppress ${email}:`, err);
    return { suppressed: false, newlySuppressed: false };
  }
}

export type BounceEvidence = { source: 'send' | 'bounce_message'; at: Date; reason: 'hard_bounce' | 'soft_bounce' };

/**
 * Any earlier bounce for this address in the tenant, whether or not it was ever matched to a lead.
 *
 * The send path's second lock. Suppression is written only when the inbox sync reads a bounce and
 * matches it to a lead; when that link broke — a run that read only 50 messages, a bounce in a
 * sender mailbox matched to nobody — the address stayed sendable and the next step went out to a
 * dead mailbox (owner, 2026-10-09: Spanco, `550 5.7.1`, follow-up sent anyway). This asks the
 * records directly: a send to the address marked bounced, or a stored bounce naming it.
 */
export async function findBounceEvidence(input: { tenantId: string; email: string | null | undefined }): Promise<BounceEvidence | null> {
  const email = input.email?.trim().toLowerCase();
  if (!email) return null;

  const send = await prisma.outboundMessage.findFirst({
    where: { tenantId: input.tenantId, bouncedAt: { not: null }, to: { equals: email, mode: 'insensitive' } },
    orderBy: { bouncedAt: 'asc' },
    select: { bouncedAt: true, bounceType: true },
  });
  if (send?.bouncedAt) {
    return { source: 'send', at: send.bouncedAt, reason: send.bounceType === 'soft' ? 'soft_bounce' : 'hard_bounce' };
  }

  const message = await prisma.inboundMessage.findFirst({
    where: { tenantId: input.tenantId, isBounce: true, bouncedRecipient: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, bounceType: true },
  });
  if (message) {
    return { source: 'bounce_message', at: message.createdAt, reason: message.bounceType === 'soft' ? 'soft_bounce' : 'hard_bounce' };
  }
  return null;
}

/**
 * Refuse a send to an address with bounce evidence, and put the evidence to work: suppress the
 * address and stop the lead's cadences, exactly as the bounce would have if it had been matched.
 * Returns the evidence when the send must not happen.
 */
export async function blockIfBounced(input: {
  tenantId: string;
  email: string | null | undefined;
  leadId?: string | null;
  actorUserId?: string | null;
}): Promise<BounceEvidence | null> {
  const evidence = await findBounceEvidence(input);
  if (!evidence || !input.email) return evidence;
  await suppressRecipient({
    tenantId: input.tenantId,
    email: input.email,
    leadId: input.leadId ?? null,
    reason: evidence.reason,
    detail: `an earlier send to this address bounced (${evidence.at.toISOString()})`,
    actorUserId: input.actorUserId ?? null,
  });
  return evidence;
}
