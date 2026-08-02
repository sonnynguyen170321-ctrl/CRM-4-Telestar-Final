import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { canAccessLead } from '@/lib/auth';
import type { OpportunityStage, OpportunityStatus, HandoffStatus, OpportunitySource } from '@prisma/client';

type OpportunitySeed = {
  tenantId: string;
  clientId: string;
  campaignId: string;
  leadId: string | null;
  accountId: string | null;
  contactId: string | null;
  meetingId: string | null;
  title: string;
  company: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactTitle: string | null;
  ownerId: string;
  createdById: string;
  source: OpportunitySource;
  stage: OpportunityStage;
  status: OpportunityStatus;
  handoffStatus: HandoffStatus;
  value: number | null;
  currency: string;
  probability: number;
  qualificationSummary: string | null;
  painPoints: string | null;
  prospectNeed: string | null;
  budgetNotes: string | null;
  authorityNotes: string | null;
  timelineNotes: string | null;
  nextStep: string | null;
  nextStepAt: Date | null;
  clientOwnerName: string | null;
  clientOwnerEmail: string | null;
};

/**
 * Create an opportunity from a qualified meeting outcome.
 * Sequential writes only — Neon HTTP driver has no interactive transactions.
 * Idempotent: returns the existing open/won opportunity if one already exists
 * for the same lead+meeting, so double-submitting an outcome never duplicates.
 */
export async function createOpportunityFromQualifiedMeeting(params: {
  user: SessionUser;
  meetingId?: string | null;
  leadId: string;
  qualificationSummary?: string | null;
  painPoints?: string | null;
  prospectNeed?: string | null;
  budgetNotes?: string | null;
  authorityNotes?: string | null;
  timelineNotes?: string | null;
  nextStep?: string | null;
  nextStepAt?: Date | null;
  value?: number | null;
  currency?: string | null;
  clientOwnerName?: string | null;
  clientOwnerEmail?: string | null;
}) {
  const lead = await prisma.lead.findUnique({
    where: { id: params.leadId },
    include: {
      campaign: { include: { client: { select: { id: true, name: true } } } },
      account: true,
      contact: true,
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!lead) throw new Error('Lead not found');

  const existing = await prisma.opportunity.findFirst({
    where: {
      tenantId: lead.tenantId,
      leadId: lead.id,
      ...(params.meetingId ? { meetingId: params.meetingId } : {}),
      status: { in: ['open', 'won'] },
    },
  });

  if (existing) return existing;

  const contactName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || null;

  const seed: OpportunitySeed = {
    tenantId: lead.tenantId,
    clientId: lead.campaign.clientId,
    campaignId: lead.campaignId,
    leadId: lead.id,
    accountId: lead.accountId,
    contactId: lead.contactId,
    meetingId: params.meetingId ?? null,
    title: `${lead.company} - ${lead.firstName} ${lead.lastName}`,
    company: lead.company,
    contactName,
    contactEmail: lead.email,
    contactPhone: lead.phone,
    contactTitle: lead.title,
    ownerId: lead.assignedToId,
    createdById: params.user.id,
    source: 'meeting_outcome',
    stage: 'pending_client_review',
    status: 'open',
    handoffStatus: 'pending',
    value: params.value ?? null,
    currency: params.currency ?? 'USD',
    probability: 10,
    qualificationSummary: params.qualificationSummary ?? null,
    painPoints: params.painPoints ?? null,
    prospectNeed: params.prospectNeed ?? null,
    budgetNotes: params.budgetNotes ?? null,
    authorityNotes: params.authorityNotes ?? null,
    timelineNotes: params.timelineNotes ?? null,
    nextStep: params.nextStep ?? null,
    nextStepAt: params.nextStepAt ?? null,
    clientOwnerName: params.clientOwnerName ?? null,
    clientOwnerEmail: params.clientOwnerEmail ?? null,
  };

  const opportunity = await prisma.opportunity.create({
    data: seed,
    include: {
      client: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
      meeting: { select: { id: true, title: true, scheduledAt: true } },
    },
  });

  await prisma.opportunityActivity.create({
    data: {
      tenantId: lead.tenantId,
      opportunityId: opportunity.id,
      userId: params.user.id,
      type: 'created',
      description: 'Opportunity created from qualified meeting outcome',
      metadata: { leadId: lead.id, meetingId: params.meetingId ?? null },
    },
  });

  await prisma.activity.create({
    data: {
      tenantId: lead.tenantId,
      userId: params.user.id,
      leadId: lead.id,
      type: 'stage_changed',
      description: 'Qualified meeting converted to opportunity pending client review',
      metadata: { opportunityId: opportunity.id, opportunityStage: opportunity.stage },
    },
  });

  return opportunity;
}

/**
 * Create a manual opportunity. Managers only — SDRs allowed only when the
 * campaign/client setting permits it (checked in the route).
 */
export async function createManualOpportunity(params: {
  user: SessionUser;
  tenantId: string;
  data: {
    leadId?: string | null;
    clientId: string;
    campaignId: string;
    accountId?: string | null;
    contactId?: string | null;
    ownerId?: string | null;
    title: string;
    company: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    contactTitle?: string | null;
    value?: number | null;
    currency?: string | null;
    probability?: number | null;
    expectedCloseDate?: Date | null;
    clientOwnerName?: string | null;
    clientOwnerEmail?: string | null;
    externalCrmName?: string | null;
    externalCrmUrl?: string | null;
    externalDealId?: string | null;
    qualificationSummary?: string | null;
    painPoints?: string | null;
    prospectNeed?: string | null;
    budgetNotes?: string | null;
    authorityNotes?: string | null;
    timelineNotes?: string | null;
    nextStep?: string | null;
    nextStepAt?: Date | null;
  };
}) {
  const { user, tenantId, data } = params;

  let leadInfo: { assignedToId: string } | null = null;
  if (data.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId },
      select: { id: true, assignedToId: true, campaignId: true },
    });
    if (!lead) throw new Error('Lead not found');
    if (!(await canAccessLead(user, { assignedToId: lead.assignedToId, campaignId: lead.campaignId }))) {
      throw new Error('Forbidden');
    }
    leadInfo = lead;
  }

  const ownerId = data.ownerId ?? leadInfo?.assignedToId ?? user.id;

  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId,
      clientId: data.clientId,
      campaignId: data.campaignId,
      leadId: data.leadId ?? null,
      accountId: data.accountId ?? null,
      contactId: data.contactId ?? null,
      title: data.title,
      company: data.company,
      contactName: data.contactName ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      contactTitle: data.contactTitle ?? null,
      ownerId,
      createdById: user.id,
      source: 'manual',
      stage: 'pending_client_review',
      status: 'open',
      handoffStatus: 'pending',
      value: data.value ?? null,
      currency: data.currency ?? 'USD',
      probability: data.probability ?? 10,
      expectedCloseDate: data.expectedCloseDate ?? null,
      clientOwnerName: data.clientOwnerName ?? null,
      clientOwnerEmail: data.clientOwnerEmail ?? null,
      externalCrmName: data.externalCrmName ?? null,
      externalCrmUrl: data.externalCrmUrl ?? null,
      externalDealId: data.externalDealId ?? null,
      qualificationSummary: data.qualificationSummary ?? null,
      painPoints: data.painPoints ?? null,
      prospectNeed: data.prospectNeed ?? null,
      budgetNotes: data.budgetNotes ?? null,
      authorityNotes: data.authorityNotes ?? null,
      timelineNotes: data.timelineNotes ?? null,
      nextStep: data.nextStep ?? null,
      nextStepAt: data.nextStepAt ?? null,
    },
    include: {
      client: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await prisma.opportunityActivity.create({
    data: {
      tenantId,
      opportunityId: opportunity.id,
      userId: user.id,
      type: 'created',
      description: 'Opportunity created manually',
      metadata: { source: 'manual' },
    },
  });

  return opportunity;
}
