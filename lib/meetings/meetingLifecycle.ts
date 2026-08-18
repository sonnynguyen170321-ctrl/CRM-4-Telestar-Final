import { prisma } from '@/lib/prisma';
import { resolveBookingLink } from './bookingLinks';
import type { SessionUser } from '@/lib/auth';
import type { MeetingStatus, MeetingOutcome } from '@prisma/client';
import { onMeetingOutcomeLogged } from '@/lib/contact-intelligence/events';

/**
 * Book a meeting for a lead. Handles:
 * - Booking link resolution and URL snapshot
 * - Lead stage update to meeting_booked (if scheduled)
 * - Sequence pause (if active)
 * - Activity logging
 * - Follow-up task creation
 */
export async function bookMeeting(input: {
  leadId: string;
  user: SessionUser;
  tenantId: string;
  bookingLinkId?: string | null;
  sourceChannel?: string | null;
  status?: 'link_sent' | 'scheduled';
  title?: string | null;
  scheduledAt?: Date | null;
  durationMins?: number;
  timezone?: string | null;
  meetingUrl?: string | null;
  clientOwnerName?: string | null;
  clientOwnerEmail?: string | null;
}) {
  const {
    leadId, user, tenantId, bookingLinkId, sourceChannel,
    status = 'scheduled', title, scheduledAt, durationMins,
    timezone, meetingUrl, clientOwnerName, clientOwnerEmail,
  } = input;

  // Fetch the lead with campaign info
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      email: true,
      campaignId: true,
      assignedToId: true,
      sequenceStatus: true,
      campaign: { select: { id: true, name: true, clientId: true, client: { select: { id: true, name: true } } } },
    },
  });

  const clientId = lead.campaign.clientId;
  const campaignId = lead.campaignId;

  // Resolve booking link
  const bookingLink = await resolveBookingLink({
    tenantId,
    clientId,
    campaignId,
    bookingLinkId,
  });

  // Build meeting title
  const meetingTitle = title || `Meeting with ${lead.firstName} ${lead.lastName} — ${lead.campaign.client.name}`;

  // Create the meeting record
  const meeting = await prisma.meeting.create({
    data: {
      leadId,
      clientId,
      campaignId,
      sdrId: user.id,
      bookingLinkId: bookingLink?.id ?? null,
      bookingLinkUrlSnapshot: bookingLink?.url ?? null,
      bookingLinkNameSnapshot: bookingLink?.name ?? null,
      sourceChannel: sourceChannel as any ?? null,
      status: status as MeetingStatus,
      title: meetingTitle,
      scheduledAt: scheduledAt ?? null,
      durationMins: durationMins ?? bookingLink?.durationMins ?? 30,
      timezone: timezone ?? bookingLink?.timezone ?? null,
      meetingUrl: meetingUrl ?? null,
      prospectName: `${lead.firstName} ${lead.lastName}`,
      prospectEmail: lead.email,
      clientOwnerName: clientOwnerName ?? bookingLink?.ownerName ?? null,
      clientOwnerEmail: clientOwnerEmail ?? bookingLink?.ownerEmail ?? null,
      tenantId,
    },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true } },
      client: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      sdr: { select: { id: true, firstName: true, lastName: true } },
      bookingLink: { select: { id: true, name: true, url: true } },
    },
  });

  // If status is 'link_sent', just log activity and return
  if (status === 'link_sent') {
    await prisma.activity.create({
      data: {
        userId: user.id,
        leadId,
        type: 'booking_link_sent',
        description: `Booking link sent: ${bookingLink?.name ?? 'manual link'}`,
        metadata: {
          meetingId: meeting.id,
          bookingLinkId: bookingLink?.id,
          bookingLinkUrl: bookingLink?.url,
        },
        tenantId,
      },
    });
    return meeting;
  }

  // For 'scheduled' status: update lead stage + pause sequence + log activity + create task
  // 1. Update lead stage to meeting_booked
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      stage: 'meeting_booked',
      lastContactedAt: new Date(),
    },
  });

  // 2. Pause active sequence enrollment if any
  if (lead.sequenceStatus === 'active') {
    await prisma.lead.update({
      where: { id: leadId },
      data: { sequenceStatus: 'paused' },
    });
    // Also pause the SequenceEnrollment record
    await prisma.sequenceEnrollment.updateMany({
      where: { leadId, status: 'active' },
      data: { status: 'paused' },
    });
  }

  // 3. Log meeting_booked activity
  await prisma.activity.create({
    data: {
      userId: user.id,
      leadId,
      type: 'meeting_booked',
      description: `Meeting scheduled: ${meetingTitle}`,
      metadata: {
        meetingId: meeting.id,
        scheduledAt: scheduledAt?.toISOString(),
        bookingLinkId: bookingLink?.id,
      },
      tenantId,
    },
  });

  // 4. Log stage change activity
  await prisma.activity.create({
    data: {
      userId: user.id,
      leadId,
      type: 'stage_changed',
      description: 'Stage changed to meeting_booked',
      metadata: { from: lead.sequenceStatus === 'active' ? 'sequence_active' : 'replied', to: 'meeting_booked' },
      tenantId,
    },
  });

  // 5. Create follow-up task to log meeting outcome
  if (scheduledAt) {
    const followUpDate = new Date(scheduledAt.getTime() + (durationMins ?? 30) * 60 * 1000 + 30 * 60 * 1000); // meeting end + 30 min
    await prisma.task.create({
      data: {
        leadId,
        userId: user.id,
        type: 'manual',
        title: `Log meeting outcome: ${lead.firstName} ${lead.lastName}`,
        description: `Meeting "${meetingTitle}" was scheduled for ${scheduledAt.toISOString()}. Log the outcome.`,
        dueDate: followUpDate,
        priority: 'high',
        tenantId,
      },
    });
  }

  return meeting;
}

/**
 * Log the outcome of a meeting.
 */
export async function logMeetingOutcome(input: {
  meetingId: string;
  user: SessionUser;
  tenantId: string;
  status: 'completed' | 'no_show' | 'cancelled' | 'rescheduled';
  outcome: string;
  outcomeNotes?: string | null;
  painPoints?: string | null;
  nextStep?: string | null;
  followUpAt?: Date | null;
  decisionMakerRole?: string | null;
  relationshipStrength?: 'weak' | 'developing' | 'strong' | 'advocate' | null;
  budgetAuthority?: string | null;
  competitiveContext?: string | null;
}) {
  const {
    meetingId, user, tenantId, status, outcome,
    outcomeNotes, painPoints, nextStep, followUpAt,
    decisionMakerRole, relationshipStrength, budgetAuthority, competitiveContext,
  } = input;

  // Update the meeting
  const meeting = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: status as MeetingStatus,
      outcome: outcome as MeetingOutcome,
      outcomeNotes,
      painPoints,
      nextStep,
      outcomeLoggedById: user.id,
      outcomeLoggedAt: new Date(),
    },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, assignedToId: true } },
    },
  });

  // Log activity
  const activityType = status === 'cancelled' ? 'meeting_cancelled'
    : status === 'rescheduled' ? 'meeting_rescheduled'
    : 'meeting_outcome_logged';

  await prisma.activity.create({
    data: {
      userId: user.id,
      leadId: meeting.leadId,
      type: activityType,
      description: `Meeting outcome: ${outcome.replace(/_/g, ' ')}${outcomeNotes ? ` — ${outcomeNotes.substring(0, 100)}` : ''}`,
      metadata: {
        meetingId,
        status,
        outcome,
        painPoints,
        nextStep,
      },
      tenantId,
    },
  });

  // Auto-create follow-up tasks for specific outcomes
  const leadInfo = (meeting as any).lead;
  if (status === 'no_show') {
    await prisma.task.create({
      data: {
        leadId: meeting.leadId,
        userId: leadInfo?.assignedToId || user.id,
        type: 'manual',
        title: `Follow up: No-show — ${leadInfo?.firstName ?? ''} ${leadInfo?.lastName ?? ''}`.trim(),
        description: `Meeting was a no-show. Reschedule or follow up.${outcomeNotes ? `\nNotes: ${outcomeNotes}` : ''}`,
        dueDate: followUpAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000), // next day
        priority: 'high',
        tenantId,
      },
    });
  } else if (status === 'rescheduled') {
    await prisma.task.create({
      data: {
        leadId: meeting.leadId,
        userId: leadInfo?.assignedToId || user.id,
        type: 'manual',
        title: `Reschedule meeting: ${leadInfo?.firstName ?? ''} ${leadInfo?.lastName ?? ''}`.trim(),
        description: `Meeting needs to be rescheduled.${nextStep ? `\nNext step: ${nextStep}` : ''}`,
        dueDate: followUpAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: 'high',
        tenantId,
      },
    });
  }

  // Hook Contact Intelligence evidence
  await onMeetingOutcomeLogged({
    meetingId,
    leadId: meeting.leadId,
    status,
    outcome,
    outcomeNotes,
    painPoints,
    nextStep,
    decisionMakerRole,
    relationshipStrength,
    budgetAuthority,
    competitiveContext,
    userId: user.id,
    tenantId,
  });

  return meeting;
}
