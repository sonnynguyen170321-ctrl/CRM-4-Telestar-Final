import { prisma } from '@/lib/prisma';

export interface ContactMemoryGenerationResult {
  contactId: string;
  relationshipSummary: string;
  commercialSummary: string;
  intelligenceSummary: string;
  generatedAt: Date;
}

/**
 * Generates structured 3-tiered commercial memory summaries from aggregated historical evidence.
 */
export async function generateContactCommercialMemory(
  contactId: string,
  tenantId: string
): Promise<ContactMemoryGenerationResult> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      intelligence: true,
      evidence: {
        where: { tenantId },
        orderBy: { observedAt: 'desc' },
        take: 30,
      },
      leadAssignments: {
        where: { tenantId },
        select: { stage: true, campaign: { select: { name: true } }, assignedTo: { select: { firstName: true, lastName: true } } },
      },
      opportunities: {
        where: { tenantId },
        select: { title: true, status: true, stage: true, value: true, currency: true },
      },
    },
  });

  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const intel = contact.intelligence;
  const evidenceList = contact.evidence;

  // 1. Synthesize Relationship Memory
  const relationshipEvents = evidenceList.filter((e) =>
    ['relationship_strengthened', 'meeting_completed', 'authority_signal', 'referral_given'].includes(e.evidenceType)
  );

  let relationshipSummary = 'No established interpersonal history recorded yet.';
  if (relationshipEvents.length > 0 || intel?.relationshipStrength) {
    const ownerName = intel?.relationshipOwnerId ? 'Assigned SDR Owner' : 'Team Shared';
    const strength = intel?.relationshipStrength ? `Status: ${intel.relationshipStrength.toUpperCase()}.` : '';
    const highlights = relationshipEvents.slice(0, 3).map((e) => e.summary).join('. ');
    relationshipSummary = `${strength} Managed under ${ownerName}. Key touchpoints: ${highlights || 'Positive interaction history.'}`;
  }

  // 2. Synthesize Commercial Memory (deals, pain points, competitor context)
  const commercialSignals = evidenceList.filter((e) =>
    ['pain_point', 'competitor_mentioned', 'budget_signal', 'timing_signal', 'opportunity_won', 'opportunity_created'].includes(e.evidenceType)
  );

  let commercialSummary = 'Standard commercial profile; no active objections or budget constraints recorded.';
  if (commercialSignals.length > 0 || contact.opportunities.length > 0) {
    const oppSummary = contact.opportunities.map((o) => `${o.title} (${o.stage}, ${o.value ? `${o.currency || 'USD'} ${o.value}` : 'unvalued'})`).join('; ');
    const signalDetails = commercialSignals.slice(0, 4).map((s) => s.summary).join('. ');
    commercialSummary = `Deal History: ${oppSummary || 'None'}. Commercial Signals: ${signalDetails || 'Active qualification in progress.'}`;
  }

  // 3. Synthesize Executive Intelligence & Next Action Summary
  let intelligenceSummary = 'Eligible for outbound campaign prospecting.';
  if (intel?.qualityClass === 'proven') {
    intelligenceSummary = 'Proven high-value commercial asset. Prioritize warm relationship re-engagement or executive multi-touch cadence.';
  } else if (intel?.qualityClass === 'promising') {
    intelligenceSummary = 'High-confidence decision-maker target matching premium ICP parameters. Ready for personalized sequence enrollment.';
  } else if (intel?.reuseStatus === 'cooldown') {
    intelligenceSummary = `Under active outreach cooldown until ${intel.cooldownUntil ? new Date(intel.cooldownUntil).toLocaleDateString() : 'expiry'}. Protect from cold automated sequences.`;
  } else if (intel?.reuseStatus === 'client_locked') {
    intelligenceSummary = 'Exclusive deal in progress with active client. Re-engagement strictly restricted to existing account team.';
  } else if (intel?.reuseStatus === 'do_not_contact') {
    intelligenceSummary = 'Suppressed or unsubscribed profile. Do not contact across any channel or campaign.';
  }

  const generatedAt = new Date();

  // Persist summaries into ContactIntelligence
  await prisma.contactIntelligence.upsert({
    where: { contactId },
    update: {
      relationshipSummary,
      commercialSummary,
      intelligenceSummary,
      lastIntelligenceAt: generatedAt,
    },
    create: {
      tenantId,
      contactId,
      relationshipSummary,
      commercialSummary,
      intelligenceSummary,
      lastIntelligenceAt: generatedAt,
    },
  });

  return {
    contactId,
    relationshipSummary,
    commercialSummary,
    intelligenceSummary,
    generatedAt,
  };
}
