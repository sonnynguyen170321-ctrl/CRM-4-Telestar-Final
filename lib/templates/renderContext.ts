/**
 * Everything the renderer needs about a lead and a sender that is not on the lead row itself - the
 * account, the campaign name, the saved AI variables, the sender's phone and calendar link - loaded
 * once so the composer preview, the send route, the sequence worker and the email worker hand
 * `renderTemplate` the same context and so produce the same words.
 *
 * Server only (reads the database). Every query is scoped by the tenant the caller already holds.
 */

import { prisma } from '@/lib/prisma';
import { readAiVariables } from '@/lib/leads/aiVariablesShape';
import type { RenderLead, RenderSdr } from '@/lib/templates/render';

type LeadRow = Omit<RenderLead, 'account' | 'campaign' | 'aiVariables'> & {
  accountId?: string | null;
  campaignId?: string | null;
};

/** The lead plus its account, campaign and saved AI variables, ready for `renderTemplate`. */
export async function loadRenderLead<T extends LeadRow & { id: string }>(tenantId: string, lead: T): Promise<Omit<T, 'account' | 'campaign'> & RenderLead> {
  const [account, campaign, insight] = await Promise.all([
    lead.accountId
      ? prisma.account.findFirst({
          where: { id: lead.accountId, tenantId },
          select: { website: true, domain: true, canonicalDomain: true, industry: true, country: true, size: true, staffCountRange: true },
        })
      : null,
    lead.campaignId ? prisma.campaign.findFirst({ where: { id: lead.campaignId, tenantId }, select: { name: true } }) : null,
    prisma.leadAiInsight.findFirst({ where: { leadId: lead.id, tenantId }, select: { variablesJson: true } }),
  ]);
  return { ...lead, account, campaign, aiVariables: readAiVariables(insight?.variablesJson) };
}

const SENDER_SELECT = { firstName: true, lastName: true, role: true, jobTitle: true, phone: true, calendarLink: true } as const;

/** The sender (whoever owns the mailbox) with the optional profile fields the Sender variables use. */
export async function loadRenderSender(tenantId: string, userId: string): Promise<RenderSdr | null> {
  return prisma.user.findFirst({ where: { id: userId, tenantId }, select: SENDER_SELECT });
}
