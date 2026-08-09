import { prisma } from '@/lib/prisma';
import { canAccessLead, type SessionUser } from '@/lib/auth';

export interface AuthoritativeLeadContext {
  leadId: string;
  leadName: string;
  leadCompany: string;
  leadStage: string;
  leadDaysSinceContact: number | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignDescription: string | null;
  clientName: string | null;
  playbookVersionId: string | null;
}

export async function loadAuthorizedLeadContext(
  sessionUser: SessionUser,
  leadId: string
): Promise<AuthoritativeLeadContext | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      stage: true,
      lastContactedAt: true,
      assignedToId: true,
      campaignId: true,
      campaign: {
        select: {
          id: true,
          name: true,
          description: true,
          client: { select: { name: true } },
          playbook: {
            select: { currentVersionId: true },
          },
        },
      },
    },
  });

  if (!lead) return null;
  
  if (!(await canAccessLead(sessionUser, lead))) {
    return null;
  }

  const daysSinceContact = lead.lastContactedAt
    ? Math.floor((Date.now() - lead.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    leadId: lead.id,
    leadName: `${lead.firstName} ${lead.lastName}`.trim(),
    leadCompany: lead.company || '',
    leadStage: lead.stage,
    leadDaysSinceContact: daysSinceContact,
    campaignId: lead.campaign?.id || null,
    campaignName: lead.campaign?.name || null,
    campaignDescription: lead.campaign?.description || null,
    clientName: lead.campaign?.client?.name || null,
    playbookVersionId: lead.campaign?.playbook?.currentVersionId || null,
  };
}
