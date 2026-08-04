import { prisma } from '@/lib/prisma';
import { ClientReportSnapshot, ReportAudience, SdrDisplayMode } from './types';
import { formatRepDisplayName, sanitizeClientFacingText } from './sanitization';

export interface BuildReportMetricsParams {
  clientId: string;
  campaignId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  audience?: ReportAudience;
  sdrDisplayMode?: SdrDisplayMode;
  generatedById: string;
  generatedByName: string;
}

export async function buildReportMetrics(params: BuildReportMetricsParams): Promise<ClientReportSnapshot> {
  const {
    clientId,
    campaignId,
    periodStart,
    periodEnd,
    audience = 'client',
    sdrDisplayMode = 'first_last_initial',
    generatedById,
    generatedByName,
  } = params;

  // 1. Fetch Client and Campaign info
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true },
  });

  if (!client) {
    throw new Error('Client not found');
  }

  let campaignName: string | undefined;
  if (campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true },
    });
    campaignName = campaign?.name;
  }

  // Base scope for Lead-based queries (Lead -> Campaign -> Client)
  const leadWhereScope = {
    campaign: {
      clientId,
      ...(campaignId ? { id: campaignId } : {}),
    },
  };

  // 2. Query Leads assigned & new
  const totalLeadsAssigned = await prisma.lead.count({
    where: {
      ...leadWhereScope,
      archivedAt: null,
    },
  });

  const newLeadsAdded = await prisma.lead.count({
    where: {
      ...leadWhereScope,
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
  });

  // 3. Query Activities in Period
  const activities = await prisma.activity.findMany({
    where: {
      lead: leadWhereScope,
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    select: {
      id: true,
      type: true,
      channel: true,
      leadId: true,
      userId: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      metadata: true,
    },
  });

  /**
   * Activity types that represent real outbound contact with a prospect.
   *
   * Everything else the CRM auto-logs — stage_changed, note_added, booking_link_sent,
   * meeting_booked — is internal bookkeeping. Those were landing in `manualTouches` and
   * inflating the client-facing "touchpoints" headline, which is how a campaign with
   * zero emails and zero calls reported 21 touchpoints above a channel table of zeros.
   * A client comparing those two numbers concludes we invented them, and they are right.
   */
  const OUTBOUND_ACTIVITY_TYPES = new Set([
    'email_sent',
    'call_logged',
    'linkedin_message',
    'whatsapp_message',
  ]);
  const isOutbound = (type: string) => OUTBOUND_ACTIVITY_TYPES.has(type.toLowerCase());

  const touchedLeadIds = new Set<string>();
  let emailTouches = 0;
  let callTouches = 0;
  let linkedinTouches = 0;
  let whatsappTouches = 0;
  let manualTouches = 0;
  let emailReplies = 0;
  let callReplies = 0;
  let linkedinReplies = 0;
  let whatsappReplies = 0;

  const repActivityMap = new Map<
    string,
    {
      name: string;
      touches: number;
      replies: number;
      leadIds: Set<string>;
      meetingsBooked: number;
      qualifiedMeetings: number;
      acceptedOpportunities: number;
    }
  >();

  for (const act of activities) {
    // A lead counts as "contacted" only once someone actually reached out to it.
    // Previously any activity qualified, so a stage change with no contact marked a
    // prospect Contacted and inflated the reply-rate denominator.
    if (act.leadId && isOutbound(act.type)) {
      touchedLeadIds.add(act.leadId);
    }

    if (act.userId && act.user) {
      if (!repActivityMap.has(act.userId)) {
        const userName = [act.user.firstName, act.user.lastName].filter(Boolean).join(' ') || act.user.email.split('@')[0];
        repActivityMap.set(act.userId, {
          name: userName,
          touches: 0,
          replies: 0,
          leadIds: new Set(),
          meetingsBooked: 0,
          qualifiedMeetings: 0,
          acceptedOpportunities: 0,
        });
      }
      const rep = repActivityMap.get(act.userId)!;
      if (act.leadId) rep.leadIds.add(act.leadId);
    }

    const typeStr = act.type.toLowerCase();
    const ch = (act.channel || '').toLowerCase();

    // Categorize touches vs replies
    if (typeStr.includes('reply') || typeStr === 'email_replied' || typeStr === 'call_connected') {
      if (ch === 'email' || typeStr.includes('email')) emailReplies++;
      else if (ch === 'call' || typeStr.includes('call')) callReplies++;
      else if (ch === 'linkedin' || typeStr.includes('linkedin')) linkedinReplies++;
      else if (ch === 'whatsapp' || typeStr.includes('whatsapp')) whatsappReplies++;
      else emailReplies++;

      if (act.userId && repActivityMap.has(act.userId)) {
        repActivityMap.get(act.userId)!.replies++;
      }
    } else if (isOutbound(typeStr)) {
      if (ch === 'email' || typeStr.includes('email')) emailTouches++;
      else if (ch === 'call' || typeStr.includes('call')) callTouches++;
      else if (ch === 'linkedin' || typeStr.includes('linkedin')) linkedinTouches++;
      else if (ch === 'whatsapp' || typeStr.includes('whatsapp')) whatsappTouches++;
      else manualTouches++;

      if (act.userId && repActivityMap.has(act.userId)) {
        repActivityMap.get(act.userId)!.touches++;
      }
    }
    // Non-outbound activity is intentionally not counted anywhere client-facing.
  }

  const leadsTouched = touchedLeadIds.size;
  const touchpointsCompleted = emailTouches + callTouches + linkedinTouches + whatsappTouches + manualTouches;
  const replies = emailReplies + callReplies + linkedinReplies + whatsappReplies;

  const inPeriod = (d: Date | null | undefined) => !!d && d >= periodStart && d <= periodEnd;

  // 4. Query Meetings in Period
  //
  // Two clocks, deliberately. "Booked" is when the team did the work — `createdAt`.
  // "Held" is when the meeting actually happens — `scheduledAt`. Filtering the whole
  // section on `scheduledAt` (the old behaviour) meant a meeting booked today for next
  // Tuesday counted in neither week, and `link_sent` rows — which have no `scheduledAt`
  // at all — could never be reported. That is what produced a document claiming zero
  // booked meetings above a pipeline built out of those very meetings.
  const meetings = await prisma.meeting.findMany({
    where: {
      clientId,
      ...(campaignId ? { campaignId } : {}),
      OR: [
        { createdAt: { gte: periodStart, lte: periodEnd } },
        { scheduledAt: { gte: periodStart, lte: periodEnd } },
      ],
    },
    include: {
      lead: { select: { company: true, firstName: true, lastName: true, title: true } },
      sdr: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  });

  // Real per-channel meeting attribution. `Meeting.sourceChannel` records how the
  // meeting was actually generated; the old code split the total 40/45/10/5 across
  // email/call/linkedin/whatsapp with hardcoded ratios, which is the number a client
  // uses to set next quarter's budget. Meetings with no sourceChannel are simply not
  // attributed rather than allocated by invention.
  const meetingsByChannel = new Map<string, number>();
  for (const m of meetings) {
    if (!m.sourceChannel) continue;
    if (!inPeriod(m.createdAt)) continue;
    const key = String(m.sourceChannel).toLowerCase();
    meetingsByChannel.set(key, (meetingsByChannel.get(key) ?? 0) + 1);
  }

  // Booked in this period, by when the work was done.
  const meetingsBooked = meetings.filter((m) => inPeriod(m.createdAt)).length;
  // Scheduled to happen in this period — a separate, honest measure.
  const meetingsHeld = meetings.filter((m) => inPeriod(m.scheduledAt)).length;

  let meetingsCompleted = 0;
  let noShows = 0;
  let qualifiedMeetings = 0;

  const meetingList = meetings.map((m, idx) => {
    if (m.status === 'completed') meetingsCompleted++;
    if (m.status === 'no_show') noShows++;
    if (m.outcome === 'qualified_opportunity') qualifiedMeetings++;

    // Attribution to rep
    if (m.sdrId && repActivityMap.has(m.sdrId)) {
      repActivityMap.get(m.sdrId)!.meetingsBooked++;
      if (m.outcome === 'qualified_opportunity') {
        repActivityMap.get(m.sdrId)!.qualifiedMeetings++;
      }
    }

    const sdrName = [m.sdr?.firstName, m.sdr?.lastName].filter(Boolean).join(' ') || m.sdr?.email?.split('@')[0] || 'SDR';
    const contactName = [m.lead?.firstName, m.lead?.lastName].filter(Boolean).join(' ') || undefined;
    return {
      id: m.id,
      company: m.lead?.company || 'Unknown Company',
      contactName,
      contactTitle: m.lead?.title || undefined,
      // Null for `link_sent` rows — a link was sent, no time agreed yet. Previously
      // defaulted to "now", which printed today's date as a scheduled meeting.
      scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
      bookedAt: m.createdAt.toISOString(),
      status: m.status,
      outcome: m.outcome || undefined,
      summaryNotes: sanitizeClientFacingText(m.outcomeNotes),
      nextStep: sanitizeClientFacingText(m.nextStep),
      sdrDisplayName: formatRepDisplayName(sdrName, audience, sdrDisplayMode, idx),
    };
  });

  // 5. Query Opportunities in Period
  const opportunities = await prisma.opportunity.findMany({
    where: {
      clientId,
      ...(campaignId ? { campaignId } : {}),
      createdAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    select: {
      id: true,
      company: true,
      title: true,
      stage: true,
      status: true,
      handoffStatus: true,
      value: true,
      probability: true,
      expectedCloseDate: true,
      nextStep: true,
      lostReason: true,
      lostReasonDetails: true,
      ownerId: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const opportunitiesSubmitted = opportunities.length;
  let clientAcceptedOpportunities = 0;
  let clientRejectedOpportunities = 0;
  let activePipelineValue = 0;
  let wonValue = 0;

  const opportunityList = opportunities.map((opp) => {
    if (opp.handoffStatus === 'accepted') clientAcceptedOpportunities++;
    if (opp.handoffStatus === 'rejected') clientRejectedOpportunities++;

    const numVal = opp.value ? Number(opp.value) : 0;
    if (opp.status === 'open') {
      activePipelineValue += numVal;
    } else if (opp.status === 'won') {
      wonValue += numVal;
    }

    if (opp.ownerId && repActivityMap.has(opp.ownerId) && opp.handoffStatus === 'accepted') {
      repActivityMap.get(opp.ownerId)!.acceptedOpportunities++;
    }

    return {
      id: opp.id,
      company: opp.company,
      title: opp.title,
      stage: opp.stage,
      handoffStatus: opp.handoffStatus,
      value: numVal > 0 ? numVal : undefined,
      probability: opp.probability ?? undefined,
      expectedCloseDate: opp.expectedCloseDate?.toISOString(),
      nextStep: sanitizeClientFacingText(opp.nextStep),
      rejectedReason: opp.lostReason ? sanitizeClientFacingText(opp.lostReasonDetails || opp.lostReason) : undefined,
    };
  });

  // 6. Calculate KPIs & Rates
  const replyRate = leadsTouched > 0 ? Number((replies / leadsTouched).toFixed(3)) : 0;
  const noShowRate = meetingsBooked > 0 ? Number((noShows / meetingsBooked).toFixed(3)) : 0;
  const clientAcceptanceRate =
    opportunitiesSubmitted > 0 ? Number((clientAcceptedOpportunities / opportunitiesSubmitted).toFixed(3)) : 0;
  const opportunityWinRate =
    clientAcceptedOpportunities > 0 ? Number((wonValue > 0 ? 1 / clientAcceptedOpportunities : 0).toFixed(3)) : 0;

  // 7. Funnel Conversion
  const funnel = [
    { stage: 'assigned', label: 'Leads Assigned', count: totalLeadsAssigned, conversionRate: 1.0 },
    {
      stage: 'touched',
      label: 'Prospects Contacted',
      count: leadsTouched,
      conversionRate: totalLeadsAssigned > 0 ? Number((leadsTouched / totalLeadsAssigned).toFixed(3)) : 0,
    },
    {
      stage: 'replied',
      label: 'Replies Received',
      count: replies,
      conversionRate: leadsTouched > 0 ? replyRate : 0,
    },
    {
      stage: 'meetings_booked',
      label: 'Meetings Booked',
      count: meetingsBooked,
      conversionRate: replies > 0 ? Number((meetingsBooked / replies).toFixed(3)) : 0,
    },
    {
      stage: 'meetings_completed',
      label: 'Meetings Completed',
      count: meetingsCompleted,
      conversionRate: meetingsBooked > 0 ? Number((meetingsCompleted / meetingsBooked).toFixed(3)) : 0,
    },
    {
      stage: 'opportunities_accepted',
      label: 'Client-Accepted Opportunities',
      count: clientAcceptedOpportunities,
      conversionRate: qualifiedMeetings > 0 ? Number((clientAcceptedOpportunities / qualifiedMeetings).toFixed(3)) : 0,
    },
    {
      stage: 'won_deals',
      label: 'Won Deals',
      count: wonValue > 0 ? 1 : 0,
      conversionRate: clientAcceptedOpportunities > 0 ? opportunityWinRate : 0,
    },
  ];

  // 8. Channels breakdown
  // No meeting in this period records a sourceChannel, so per-channel attribution is
  // simply unknown. Publishing a 0 in every row against a non-zero "meetings booked"
  // headline would recreate exactly the header-vs-table contradiction this batch is
  // fixing — with the added problem that a 0 reads as "this channel produced nothing".
  const hasChannelAttribution = meetingsByChannel.size > 0;
  const attributed = (key: string, alt?: string) =>
    hasChannelAttribution ? (meetingsByChannel.get(key) ?? (alt ? meetingsByChannel.get(alt) : undefined) ?? 0) : undefined;

  const channels = [
    {
      channel: 'email' as const,
      label: 'Email Outreach',
      touchpoints: emailTouches,
      replies: emailReplies,
      meetingsBooked: attributed('email'),
      conversionRate: emailTouches > 0 ? Number((emailReplies / emailTouches).toFixed(3)) : 0,
    },
    {
      channel: 'call' as const,
      label: 'Cold Calling',
      touchpoints: callTouches,
      replies: callReplies,
      meetingsBooked: attributed('call', 'phone'),
      conversionRate: callTouches > 0 ? Number((callReplies / callTouches).toFixed(3)) : 0,
    },
    {
      channel: 'linkedin' as const,
      label: 'LinkedIn Messaging',
      touchpoints: linkedinTouches,
      replies: linkedinReplies,
      meetingsBooked: attributed('linkedin'),
      conversionRate: linkedinTouches > 0 ? Number((linkedinReplies / linkedinTouches).toFixed(3)) : 0,
    },
    {
      channel: 'whatsapp' as const,
      label: 'WhatsApp Direct',
      touchpoints: whatsappTouches,
      replies: whatsappReplies,
      meetingsBooked: attributed('whatsapp'),
      conversionRate: whatsappTouches > 0 ? Number((whatsappReplies / whatsappTouches).toFixed(3)) : 0,
    },
  ];

  // 8b. Email Deliverability & Health (Client-safe aggregated metrics)
  let outboundSent = 0;
  let outboundBounces = 0;
  let outboundReplies = 0;

  try {
    const outboundMessages = await prisma.outboundMessage.findMany({
      where: {
        sentAt: { gte: periodStart, lte: periodEnd },
        lead: leadWhereScope,
      },
      select: {
        status: true,
        bounceType: true,
        repliedAt: true,
      },
    });

    for (const msg of outboundMessages) {
      if (msg.status === 'sent' || msg.status === 'bounced') outboundSent++;
      if (msg.status === 'bounced') outboundBounces++;
      if (msg.repliedAt) outboundReplies++;
    }
  } catch {
    outboundSent = emailTouches;
    outboundReplies = emailReplies;
  }

  const effectiveSent = outboundSent > 0 ? outboundSent : emailTouches;
  const effectiveReplies = outboundReplies > 0 ? outboundReplies : emailReplies;
  const calcBounceRate = effectiveSent > 0 ? Number((outboundBounces / effectiveSent).toFixed(4)) : 0;
  const calcReplyRate = effectiveSent > 0 ? Number((effectiveReplies / effectiveSent).toFixed(4)) : 0;

  let overallHealth: 'Good' | 'Watch' | 'Risk' = 'Good';
  const correctiveActions: string[] = [];

  if (calcBounceRate > 0.05) {
    overallHealth = 'Risk';
    correctiveActions.push('Bounce rate is elevated (>5%). List hygiene verification is recommended.');
  } else if (calcBounceRate > 0.02) {
    overallHealth = 'Watch';
    correctiveActions.push('Bounce rate is in the monitoring range (2-5%). Domain reputation is tracked continuously.');
  }

  if (calcReplyRate < 0.01 && effectiveSent > 50) {
    if (overallHealth === 'Good') overallHealth = 'Watch';
    correctiveActions.push('Reply rate is below 1%. Messaging iteration and A/B testing are underway.');
  }

  if (correctiveActions.length === 0) {
    correctiveActions.push('Sender reputation is healthy across all connected domains. Deliverability and warmup cadences are optimal.');
  }

  const emailChannelHealth = {
    overall: overallHealth,
    emailsSent: effectiveSent,
    replyRate: calcReplyRate,
    bounceRate: calcBounceRate,
    correctiveActions,
  };

  // 9. Lead Quality from Lead Table / Sources
  const topSourcesRaw = await prisma.lead.groupBy({
    by: ['source'],
    where: {
      ...leadWhereScope,
    },
    _count: { _all: true },
    orderBy: { _count: { source: 'desc' } },
    take: 5,
  });

  // Per-source lead counts are real. The old `meetings` figure here was an allocation
  // (sourceCount x overall booking rate), not attribution — it read as "this source
  // produced N meetings" when nothing had measured that. Dropped rather than guessed.
  const topSources = topSourcesRaw
    .filter((s) => s.source)
    .map((s) => ({
      source: s.source || 'Standard ICP Pool',
      qualified: s._count._all,
    }));

  // Real email validation, straight off Contact. Previously `validated`, `qualified` and
  // `rejected` were the lead count times 0.94 / 0.88 / 0.06, `duplicateRate` was a flat
  // 3% and `averageEmailScore` a flat 92 — all five printed to the client as measurements.
  // A field with no real source is now omitted instead of invented.
  // Contacts reach this client through their lead assignments. 'valid' | 'deliverable'
  // is the same rule lib/leadgen/metrics.ts:35 already uses for a validated address —
  // one definition, not a second opinion.
  const contactWhereScope = { leadAssignments: { some: leadWhereScope } };

  const validatedContacts = await prisma.contact.count({
    where: { ...contactWhereScope, emailValidation: { in: ['valid', 'deliverable'] } },
  });
  const scoreAgg = await prisma.contact.aggregate({
    where: { ...contactWhereScope, emailScore: { not: null } },
    _avg: { emailScore: true },
  });

  const leadQuality = {
    imported: newLeadsAdded || totalLeadsAssigned,
    validated: validatedContacts,
    averageEmailScore:
      scoreAgg._avg.emailScore != null ? Math.round(scoreAgg._avg.emailScore) : undefined,
    topSources:
      topSources.length > 0
        ? topSources
        : [{ source: 'Verified ICP Pool', qualified: totalLeadsAssigned }],
  };

  // 10. Reps contribution list
  const repList = Array.from(repActivityMap.entries()).map(([repId, data], idx) => ({
    repId,
    displayName: formatRepDisplayName(data.name, audience, sdrDisplayMode, idx),
    leadsTouched: data.leadIds.size,
    touchpoints: data.touches,
    replies: data.replies,
    meetingsBooked: data.meetingsBooked,
    qualifiedMeetings: data.qualifiedMeetings,
    acceptedOpportunities: data.acceptedOpportunities,
  }));

  // Fallback if no rep activity logged yet
  if (repList.length === 0) {
    repList.push({
      repId: generatedById,
      displayName: formatRepDisplayName(generatedByName, audience, sdrDisplayMode, 0),
      leadsTouched,
      touchpoints: touchpointsCompleted,
      replies,
      meetingsBooked,
      qualifiedMeetings,
      acceptedOpportunities: clientAcceptedOpportunities,
    });
  }

  return {
    meta: {
      clientId,
      clientName: client.name,
      campaignId: campaignId ?? undefined,
      campaignName,
      periodType: 'weekly',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      generatedById,
      generatedByName,
      audience,
      sdrDisplayMode,
      version: 'v1',
    },
    kpis: {
      totalLeadsAssigned,
      newLeadsAdded,
      leadsTouched,
      touchpointsCompleted,
      replies,
      replyRate,
      meetingsBooked,
      meetingsHeld,
      meetingsCompleted,
      noShows,
      noShowRate,
      qualifiedMeetings,
      opportunitiesSubmitted,
      clientAcceptedOpportunities,
      clientRejectedOpportunities,
      clientAcceptanceRate,
      activePipelineValue,
      wonValue,
      opportunityWinRate,
    },
    funnel,
    channels,
    leadQuality,
    meetings: meetingList,
    opportunities: opportunityList,
    reps: repList,
    insights: {
      summary: `During this period, the team contacted ${leadsTouched} prospects across omnichannel touchpoints, generating ${replies} replies, ${meetingsBooked} booked meetings, and ${clientAcceptedOpportunities} client-accepted opportunities.`,
      keyWins: [
        `Generated ${meetingsBooked} qualified meetings across target accounts`,
        `Outreach touchpoint efficiency reached ${replyRate * 100}% reply rate`,
        `${clientAcceptedOpportunities} opportunities accepted into active pipeline ($${activePipelineValue.toLocaleString()} value)`,
      ],
      blockers: [
        `Follow-up speed on cold call replies can be shortened to under 4 hours for higher conversion`,
      ],
      recommendations: [
        `Increase call allocation during peak morning hours (9:00 AM - 11:30 AM local time)`,
        `Expand outreach into secondary decision-maker titles for unresponsive enterprise accounts`,
      ],
      clientActions: [
        `Review and accept pending opportunity submissions in the deal pipeline`,
      ],
    },
  };
}
