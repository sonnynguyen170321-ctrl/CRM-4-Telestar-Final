import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';

/**
 * Opportunity lifecycle transitions. Single source of truth for stage moves and
 * client handoff decisions. Sequential writes only — Neon HTTP driver has no
 * interactive transactions; the lead sync is written last and each step is
 * idempotent so a retry converges on the same end state.
 */

export async function moveStage(input: {
  opportunityId: string;
  user: SessionUser;
  tenantId: string;
  stage: string;
  note?: string | null;
  value?: number | null;
  probability?: number | null;
  expectedCloseDate?: Date | null;
  lostReason?: string | null;
  lostReasonDetails?: string | null;
}) {
  const { opportunityId, user, tenantId } = input;

  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { lead: { select: { id: true } } },
  });
  if (!opp) throw new Error('Opportunity not found');

  const prevStage = opp.stage;

  if (input.stage === 'lost' && !input.lostReason) {
    throw new Error('Lost reason is required when moving to lost');
  }

  const data: Record<string, unknown> = { stage: input.stage };
  if (input.value != null) data.value = input.value;
  if (input.probability != null) data.probability = input.probability;
  if (input.expectedCloseDate !== undefined && input.expectedCloseDate !== null) data.expectedCloseDate = input.expectedCloseDate;
  if (input.lostReason) data.lostReason = input.lostReason;
  if (input.lostReasonDetails) data.lostReasonDetails = input.lostReasonDetails;

  // Walking the stage dropdown past pending_client_review *is* the client accepting the
  // handoff, but only decideHandoff (the separate modal) ever wrote handoffStatus — so
  // acceptance stayed 'pending' even on won deals, pinning clientAcceptanceRate at 0%
  // while the report showed a six-figure won value. Record it here too.
  //
  // Deliberately narrow: a `lost` that follows acceptance is an ordinary sales loss and
  // must not rewrite the acceptance. Only a loss straight out of pending_client_review
  // means the client refused the handoff.
  const ACCEPTED_STAGES = ['accepted_by_client', 'discovery', 'proposal', 'negotiation', 'won'];
  if (opp.handoffStatus === 'pending') {
    if (ACCEPTED_STAGES.includes(input.stage)) {
      data.handoffStatus = 'accepted';
    } else if (input.stage === 'lost' && prevStage === 'pending_client_review') {
      data.handoffStatus = 'rejected';
    }
  }

  let activityType = 'stage_changed';
  if (input.stage === 'won') {
    data.status = 'won';
    data.closedAt = new Date();
    activityType = 'closed_won';
  } else if (input.stage === 'lost') {
    data.status = 'lost';
    data.closedAt = new Date();
    activityType = 'closed_lost';
  } else if (opp.status === 'lost' || opp.status === 'rejected') {
    // Reopening a closed opportunity resets status to open.
    data.status = 'open';
    data.closedAt = null;
  }

  const updated = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: data as never,
    include: {
      client: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  await prisma.opportunityActivity.create({
    data: {
      tenantId,
      opportunityId,
      userId: user.id,
      type: activityType as never,
      description: `Stage changed from ${prevStage} to ${input.stage}`,
      metadata: {
        from: prevStage,
        to: input.stage,
        note: input.note ?? null,
        value: input.value ?? null,
        probability: input.probability ?? null,
      },
    },
  });

  // Lead stage sync — written last. Won/lost closes the lead lifecycle.
  if ((input.stage === 'won' || input.stage === 'lost') && opp.lead) {
    await prisma.lead.update({
      where: { id: opp.lead.id },
      data: { stage: input.stage },
    });
  }

  return updated;
}

export async function decideHandoff(input: {
  opportunityId: string;
  user: SessionUser;
  tenantId: string;
  decision: 'accepted' | 'rejected' | 'needs_more_info';
  clientFeedback?: string | null;
  lostReason?: string | null;
  lostReasonDetails?: string | null;
}) {
  const { opportunityId, user, tenantId, decision } = input;

  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      lead: { select: { id: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!opp) throw new Error('Opportunity not found');

  let updated;
  let activityType: string;
  let activityDescription: string;

  if (decision === 'accepted') {
    updated = await prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        handoffStatus: 'accepted',
        stage: 'accepted_by_client',
        status: 'open',
        clientFeedback: input.clientFeedback ?? null,
        closedAt: null,
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    activityType = 'client_accepted';
    activityDescription = 'Client accepted the qualified meeting — opportunity is active pipeline';
  } else if (decision === 'rejected') {
    const lostReason = input.lostReason ?? 'client_rejected';
    updated = await prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        handoffStatus: 'rejected',
        stage: 'lost',
        status: 'rejected',
        lostReason: lostReason as never,
        lostReasonDetails: input.lostReasonDetails ?? null,
        clientFeedback: input.clientFeedback ?? null,
        closedAt: new Date(),
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    activityType = 'client_rejected';
    activityDescription = `Client rejected the qualified meeting (${lostReason})`;
  } else {
    updated = await prisma.opportunity.update({
      where: { id: opportunityId },
      data: {
        handoffStatus: 'needs_more_info',
        clientFeedback: input.clientFeedback ?? null,
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    activityType = 'note_added';
    activityDescription = 'Client requested more information on the opportunity';

    // Follow-up task for the SDR/owner to gather missing info.
    if (opp.lead) {
      await prisma.task.create({
        data: {
          leadId: opp.lead.id,
          userId: opp.owner.id,
          type: 'manual',
          title: `Follow up: Client needs more info — ${opp.title}`,
          description: input.clientFeedback
            ? `Client requested more information.\nFeedback: ${input.clientFeedback}`
            : 'Client requested more information on this opportunity.',
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          priority: 'high',
          tenantId,
        },
      });
    }
  }

  await prisma.opportunityActivity.create({
    data: {
      tenantId,
      opportunityId,
      userId: user.id,
      type: activityType as never,
      description: activityDescription,
      metadata: { decision, clientFeedback: input.clientFeedback ?? null },
    },
  });

  if (decision === 'rejected' && opp.lead) {
    await prisma.lead.update({
      where: { id: opp.lead.id },
      data: { stage: 'lost' },
    });
  }

  return updated;
}

/** Append a free-form note to an opportunity's activity feed. */
export async function addOpportunityNote(input: {
  opportunityId: string;
  user: SessionUser;
  tenantId: string;
  note: string;
}) {
  await prisma.opportunityActivity.create({
    data: {
      tenantId: input.tenantId,
      opportunityId: input.opportunityId,
      userId: input.user.id,
      type: 'note_added',
      description: input.note,
      metadata: {},
    },
  });
}
