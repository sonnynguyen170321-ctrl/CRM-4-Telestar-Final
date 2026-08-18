import { prisma } from '@/lib/prisma';
import type { Lead } from '@prisma/client';
import type { SessionUser } from '@/lib/auth';
import { evaluateContactReuseEligibility } from './reuse';
import { emitContactEvidence } from './evidence';
import { recalculateContactIntelligence } from './service';
import { logLeadgenActivity } from '@/lib/leadgen/pool';

export interface AssignInternalContactsInput {
  campaignId: string;
  contactIds: string[];
  assignedSdrId?: string | null;
  actor: SessionUser;
  tenantId: string;
}

export interface AssignInternalContactsResult {
  assignedCount: number;
  skippedCount: number;
  assignedLeads: Array<{ id: string; contactId: string; name: string; company: string }>;
  skippedContacts: Array<{ contactId: string; reason: string }>;
}

export async function assignInternalInventoryToCampaign(
  input: AssignInternalContactsInput
): Promise<AssignInternalContactsResult> {
  const { campaignId, contactIds, assignedSdrId, actor, tenantId } = input;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, clientId: true, name: true },
  });
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const contacts = await prisma.contact.findMany({
    where: {
      id: { in: contactIds },
      tenantId,
    },
    include: {
      intelligence: true,
      leadAssignments: {
        where: { tenantId },
        select: { campaignId: true, archivedAt: true, sequenceStatus: true },
      },
      opportunities: {
        where: { tenantId },
        select: { clientId: true, status: true },
      },
    },
  });

  const assignedLeads: AssignInternalContactsResult['assignedLeads'] = [];
  const skippedContacts: AssignInternalContactsResult['skippedContacts'] = [];

  for (const contact of contacts) {
    const isEnrolledInAny = contact.leadAssignments.some((l) => l.sequenceStatus === 'active');
    const isAlreadyInThisCampaign = contact.leadAssignments.some((l) => l.campaignId === campaignId && !l.archivedAt);
    const activeOpp = contact.opportunities.find((o) => o.status === 'open');

    if (isAlreadyInThisCampaign) {
      skippedContacts.push({ contactId: contact.id, reason: 'Already assigned to this campaign' });
      continue;
    }

    const evalResult = evaluateContactReuseEligibility({
      isSuppressed: contact.intelligence?.lifecycleState === 'suppressed',
      isArchived: false,
      isDataInvalid: contact.intelligence?.dataStatus === 'invalid',
      dataStatus: contact.intelligence?.dataStatus || 'partial',
      hasActiveOpportunity: !!activeOpp,
      activeOpportunityClientId: activeOpp?.clientId,
      targetClientId: campaign.clientId,
      isCurrentlyEnrolled: isEnrolledInAny,
      hasRelationshipOwner: !!contact.intelligence?.relationshipOwnerId,
      relationshipOwnerId: contact.intelligence?.relationshipOwnerId,
      lastContactedAt: contact.intelligence?.lastContactedAt,
      freshnessScore: contact.intelligence?.freshnessScore ?? 100,
    });

    if (!evalResult.isEligible) {
      skippedContacts.push({ contactId: contact.id, reason: evalResult.reasons.join('; ') });
      continue;
    }

    // Create the Lead in the destination campaign
    const lead: Lead = await prisma.lead.create({
      data: {
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        company: contact.company || 'Unknown',
        title: contact.title || '',
        email: contact.email,
        phone: contact.phone || null,
        linkedIn: contact.linkedIn || null,
        whatsApp: contact.whatsApp || null,
        stage: 'new',
        crmPriorityScore: contact.intelligence?.qualityClass === 'proven' ? 'hot' : 'warm',
        campaignId,
        contactId: contact.id,
        assignedToId: assignedSdrId || actor.id,
        source: 'internal_inventory',
        tenantId,
      },
    });

    assignedLeads.push({
      id: lead.id,
      contactId: contact.id,
      name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Contact',
      company: contact.company || 'Unknown',
    });

    // Emit evidence
    await emitContactEvidence({
      tenantId,
      contactId: contact.id,
      evidenceType: 'contacted',
      key: 'campaign_assigned',
      summary: `Assigned from Internal Asset Inventory to campaign "${campaign.name}"`,
      sourceType: 'sdr_manual',
      sourceId: lead.id,
      sourceModel: 'Lead',
      clientId: campaign.clientId,
      campaignId: campaign.id,
      leadId: lead.id,
      capturedById: actor.id,
      confidence: 100,
      valueJson: { campaignId, assignedSdrId: assignedSdrId || null },
    });

    // Log leadgen activity
    await logLeadgenActivity({
      actor,
      type: 'assigned_to_campaign',
      description: `Assigned internal contact ${contact.firstName || ''} ${contact.lastName || ''} to ${campaign.name}`,
      metadata: { campaignId, leadId: lead.id, contactId: contact.id },
    });

    // Recalculate intelligence in the background
    await recalculateContactIntelligence(contact.id, tenantId);
  }

  // If there's an open CampaignLeadRequirement, increment deliveredCount
  if (assignedLeads.length > 0) {
    const openReq = await prisma.campaignLeadRequirement.findFirst({
      where: { campaignId, tenantId, status: 'open' },
      select: { id: true, deliveredCount: true, requiredCount: true },
    });

    if (openReq) {
      const newDelivered = openReq.deliveredCount + assignedLeads.length;
      await prisma.campaignLeadRequirement.update({
        where: { id: openReq.id },
        data: {
          deliveredCount: newDelivered,
          ...(newDelivered >= openReq.requiredCount ? { status: 'fulfilled' } : {}),
        },
      });
    }
  }

  return {
    assignedCount: assignedLeads.length,
    skippedCount: skippedContacts.length,
    assignedLeads,
    skippedContacts,
  };
}
