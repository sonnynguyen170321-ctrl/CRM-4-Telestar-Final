import { prisma } from '@/lib/prisma';
import type { ContactEvidenceType, EvidenceSourceType } from '@prisma/client';
import { emitContactEvidence } from './evidence';
import { recalculateContactIntelligence } from './service';

/**
 * P2.1: Hook Leadgen QA Qualification & Sourcing Evidence.
 * Emits identity/employment/QA evidence and recalculates ContactIntelligence.
 */
export async function onLeadgenItemQualified(params: {
  poolItemId: string;
  qualification: string;
  actorId?: string | null;
  tenantId: string;
  reason?: string | null;
  qaNotes?: string | null;
}): Promise<void> {
  try {
    const poolItem = await prisma.leadPoolItem.findUnique({
      where: { id: params.poolItemId },
      select: {
        id: true,
        contactId: true,
        company: true,
        title: true,
        email: true,
        phone: true,
        linkedIn: true,
        emailValidation: true,
      },
    });

    if (!poolItem || !poolItem.contactId) return;

    const contactId = poolItem.contactId;
    const isQualified = params.qualification === 'qualified';

    if (isQualified) {
      // 1. Identity verified
      await emitContactEvidence({
        tenantId: params.tenantId,
        contactId,
        evidenceType: 'identity_verified',
        key: 'leadgen_qa',
        summary: `Leadgen QA verified contact profile at ${poolItem.company}`,
        sourceType: 'leadgen',
        sourceId: poolItem.id,
        sourceModel: 'LeadPoolItem',
        capturedById: params.actorId ?? null,
        confidence: 95,
        humanConfirmed: true,
        valueJson: {
          qualification: params.qualification,
          notes: params.qaNotes ?? null,
          title: poolItem.title,
          company: poolItem.company,
        },
      });

      // 2. Employment verified
      await emitContactEvidence({
        tenantId: params.tenantId,
        contactId,
        evidenceType: 'employment_verified',
        key: 'employment_current',
        summary: `Current employment confirmed: ${poolItem.title || 'Role'} at ${poolItem.company}`,
        sourceType: 'leadgen',
        sourceId: poolItem.id,
        sourceModel: 'LeadPoolItem',
        capturedById: params.actorId ?? null,
        confidence: 90,
        humanConfirmed: true,
        valueJson: { company: poolItem.company, title: poolItem.title },
      });

      // 3. Email verified if deliverable
      if (poolItem.emailValidation === 'deliverable') {
        await emitContactEvidence({
          tenantId: params.tenantId,
          contactId,
          evidenceType: 'email_verified',
          key: 'email_deliverable',
          summary: `Deliverable email verified: ${poolItem.email}`,
          sourceType: 'leadgen',
          sourceId: poolItem.id,
          sourceModel: 'LeadPoolItem',
          confidence: 100,
          valueJson: { email: poolItem.email },
        });
      }
    } else if (params.qualification === 'invalid_contact' || params.qualification === 'invalid_company') {
      await emitContactEvidence({
        tenantId: params.tenantId,
        contactId,
        evidenceType: 'email_invalid',
        key: 'qa_invalid',
        summary: `Leadgen QA marked contact as invalid: ${params.reason || params.qualification}`,
        sourceType: 'leadgen',
        sourceId: poolItem.id,
        sourceModel: 'LeadPoolItem',
        capturedById: params.actorId ?? null,
        confidence: 90,
        humanConfirmed: true,
        valueJson: { reason: params.reason, notes: params.qaNotes },
      });
    }

    await recalculateContactIntelligence(contactId, params.tenantId);
  } catch (err) {
    console.error('[contact-intelligence/events] onLeadgenItemQualified failed:', err);
  }
}

/**
 * P2.2: Hook Activity Logging & Replies.
 * Emits interaction evidence (contacted, reply, positive_reply, etc.) and recalculates ContactIntelligence.
 */
export async function onActivityLogged(params: {
  activityId?: string;
  leadId?: string | null;
  type: string;
  channel?: string | null;
  metadata?: Record<string, unknown> | null;
  userId?: string | null;
  tenantId: string;
}): Promise<void> {
  try {
    if (!params.leadId) return;

    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      select: { id: true, contactId: true, campaignId: true },
    });

    if (!lead || !lead.contactId) return;
    const contactId = lead.contactId;

    let evidenceType: ContactEvidenceType = 'contacted';
    let sourceType: EvidenceSourceType = 'sdr_manual';
    let confidence = 90;

    const channel = (params.channel ?? 'email').toLowerCase();
    if (channel === 'email') sourceType = 'email';
    else if (channel === 'call' || channel === 'phone') sourceType = 'call';
    else if (channel === 'linkedin') sourceType = 'linkedin';
    else if (channel === 'whatsapp') sourceType = 'whatsapp';

    const actType = params.type;
    if (actType.includes('reply') || actType === 'email_replied' || actType === 'reply_received') {
      sourceType = 'prospect_message';
      const sentiment = (params.metadata?.sentiment as string) || (params.metadata?.replyClass as string);
      if (sentiment === 'positive' || sentiment === 'interested') {
        evidenceType = 'positive_reply';
        confidence = 95;
      } else if (sentiment === 'negative' || sentiment === 'not_interested') {
        evidenceType = 'negative_reply';
      } else if (sentiment === 'not_now') {
        evidenceType = 'not_now';
      } else if (sentiment === 'wrong_person') {
        evidenceType = 'wrong_person';
      } else {
        evidenceType = 'reply';
      }
    } else if (actType === 'call_made' || actType === 'call_logged') {
      evidenceType = 'contacted';
      sourceType = 'call';
    } else if (actType === 'email_sent' || actType === 'sequence_step_sent') {
      evidenceType = 'contacted';
      sourceType = 'email';
    } else if (actType === 'meeting_booked') {
      evidenceType = 'meeting_booked';
      confidence = 100;
    }

    await emitContactEvidence({
      tenantId: params.tenantId,
      contactId,
      evidenceType,
      key: `act_${params.type}`,
      summary: `Activity logged: ${params.type} via ${channel}`,
      sourceType,
      sourceId: params.activityId ?? null,
      sourceModel: 'Activity',
      campaignId: lead.campaignId,
      leadId: lead.id,
      capturedById: params.userId ?? null,
      confidence,
      valueJson: (params.metadata ?? {}) as Record<string, unknown>,
    });

    await recalculateContactIntelligence(contactId, params.tenantId);
  } catch (err) {
    console.error('[contact-intelligence/events] onActivityLogged failed:', err);
  }
}

/**
 * P2.3: Hook Meeting Outcomes.
 * Emits meeting evidence (meeting_completed, meeting_no_show, relationship_strengthened).
 */
export async function onMeetingOutcomeLogged(params: {
  meetingId: string;
  leadId: string;
  status: 'completed' | 'no_show' | 'cancelled' | 'rescheduled';
  outcome: string;
  outcomeNotes?: string | null;
  painPoints?: string | null;
  nextStep?: string | null;
  userId: string;
  tenantId: string;
}): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      select: { id: true, contactId: true, campaignId: true, campaign: { select: { clientId: true } } },
    });

    if (!lead || !lead.contactId) return;
    const contactId = lead.contactId;

    let evidenceType: ContactEvidenceType = 'meeting_completed';
    if (params.status === 'no_show') {
      evidenceType = 'meeting_no_show';
    } else if (params.status === 'completed') {
      evidenceType = 'meeting_completed';
    }

    await emitContactEvidence({
      tenantId: params.tenantId,
      contactId,
      evidenceType,
      key: `meeting_${params.status}`,
      summary: `Meeting ${params.status}: ${params.outcome}${params.outcomeNotes ? ` — ${params.outcomeNotes}` : ''}`,
      sourceType: 'meeting',
      sourceId: params.meetingId,
      sourceModel: 'Meeting',
      clientId: lead.campaign.clientId,
      campaignId: lead.campaignId,
      leadId: lead.id,
      meetingId: params.meetingId,
      capturedById: params.userId,
      confidence: 100,
      humanConfirmed: true,
      valueJson: {
        status: params.status,
        outcome: params.outcome,
        notes: params.outcomeNotes ?? null,
        painPoints: params.painPoints ?? null,
        nextStep: params.nextStep ?? null,
      },
    });

    if (params.status === 'completed') {
      // Strengthen relationship
      await emitContactEvidence({
        tenantId: params.tenantId,
        contactId,
        evidenceType: 'relationship_strengthened',
        key: 'meeting_outcome_positive',
        summary: `Relationship strengthened via completed meeting`,
        sourceType: 'meeting',
        sourceId: params.meetingId,
        sourceModel: 'Meeting',
        clientId: lead.campaign.clientId,
        campaignId: lead.campaignId,
        capturedById: params.userId,
        confidence: 90,
      });
    }

    await recalculateContactIntelligence(contactId, params.tenantId);
  } catch (err) {
    console.error('[contact-intelligence/events] onMeetingOutcomeLogged failed:', err);
  }
}

/**
 * P2.4: Hook Opportunity Stage Transitions.
 * Emits commercial evidence (opportunity_created, client_accepted, client_rejected, opportunity_won, opportunity_lost)
 * and manages client-locked state.
 */
export async function onOpportunityStageChanged(params: {
  opportunityId: string;
  stage: string;
  prevStage?: string | null;
  handoffStatus?: string | null;
  value?: number | null;
  userId: string;
  tenantId: string;
  note?: string | null;
}): Promise<void> {
  try {
    const opp = await prisma.opportunity.findUnique({
      where: { id: params.opportunityId },
      select: {
        id: true,
        contactId: true,
        leadId: true,
        clientId: true,
        campaignId: true,
        lead: { select: { contactId: true } },
      },
    });

    if (!opp) return;
    const contactId = opp.contactId || opp.lead?.contactId;
    if (!contactId) return;

    let evidenceType: ContactEvidenceType = 'opportunity_created';
    if (params.stage === 'accepted_by_client' || params.handoffStatus === 'accepted') {
      evidenceType = 'client_accepted';
    } else if (params.stage === 'won') {
      evidenceType = 'opportunity_won';
    } else if (params.stage === 'lost' || params.handoffStatus === 'rejected') {
      evidenceType = params.handoffStatus === 'rejected' ? 'client_rejected' : 'opportunity_lost';
    } else if (params.stage === 'nurture') {
      evidenceType = 'opportunity_nurture';
    }

    await emitContactEvidence({
      tenantId: params.tenantId,
      contactId,
      evidenceType,
      key: `opp_stage_${params.stage}`,
      summary: `Opportunity transition to ${params.stage}${params.value ? ` ($${params.value})` : ''}`,
      sourceType: 'opportunity',
      sourceId: opp.id,
      sourceModel: 'Opportunity',
      clientId: opp.clientId,
      campaignId: opp.campaignId,
      leadId: opp.leadId ?? null,
      opportunityId: opp.id,
      capturedById: params.userId,
      confidence: 100,
      humanConfirmed: true,
      valueJson: {
        stage: params.stage,
        prevStage: params.prevStage ?? null,
        handoffStatus: params.handoffStatus ?? null,
        value: params.value ?? null,
        note: params.note ?? null,
      },
    });

    await recalculateContactIntelligence(contactId, params.tenantId);
  } catch (err) {
    console.error('[contact-intelligence/events] onOpportunityStageChanged failed:', err);
  }
}

/**
 * P2.5: Hook Suppression & Archive Lifecycle Triggers.
 * Emits suppressed/unsubscribed/dnc evidence and recalculates ContactIntelligence.
 */
export async function onSuppressionOrArchive(params: {
  email?: string | null;
  leadId?: string | null;
  contactId?: string | null;
  reason: 'unsubscribe' | 'dnc' | 'manual_suppress' | 'bounced' | 'archived';
  tenantId: string;
  actorId?: string | null;
}): Promise<void> {
  try {
    let contactId = params.contactId;

    if (!contactId && params.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: params.leadId },
        select: { contactId: true },
      });
      if (lead) contactId = lead.contactId;
    }

    if (!contactId && params.email) {
      const contact = await prisma.contact.findFirst({
        where: {
          tenantId: params.tenantId,
          email: { equals: params.email, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (contact) contactId = contact.id;
    }

    if (!contactId) return;

    let evidenceType: ContactEvidenceType = 'suppressed';
    if (params.reason === 'unsubscribe') evidenceType = 'unsubscribed';
    else if (params.reason === 'dnc') evidenceType = 'dnc';
    else if (params.reason === 'manual_suppress') evidenceType = 'suppressed';

    await emitContactEvidence({
      tenantId: params.tenantId,
      contactId,
      evidenceType,
      key: `suppression_${params.reason}`,
      summary: `Contact suppressed/archived due to: ${params.reason}`,
      sourceType: 'sdr_manual',
      capturedById: params.actorId ?? null,
      confidence: 100,
      valueJson: { reason: params.reason },
    });

    await recalculateContactIntelligence(contactId, params.tenantId);
  } catch (err) {
    console.error('[contact-intelligence/events] onSuppressionOrArchive failed:', err);
  }
}
