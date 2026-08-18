import { prisma } from '@/lib/prisma';

export type NextBestActionType =
  | 'REPLY'
  | 'CALL'
  | 'FOLLOW_UP'
  | 'RESEARCH'
  | 'SCHEDULE'
  | 'REVIEW'
  | 'ESCALATE'
  | 'REASSIGN'
  | 'DO_NOT_CONTACT'
  | 'WAIT';

export interface NextBestActionResult {
  action: NextBestActionType;
  leadId: string;
  leadName: string;
  company: string;
  priority: 'hot' | 'warm' | 'cold';
  reason: string;
  deadline: Date;
  confidence: number;
  sourceEvidence: string[];
}

/**
 * 🎯 SDR NEXT BEST ACTION ENGINE (Section 23)
 * Calculates the next optimal action for an SDR with concrete deadlines, rationale, and source evidence.
 */
export async function calculateNextBestAction(params: {
  leadId: string;
  tenantId: string;
}): Promise<NextBestActionResult | null> {
  const { leadId, tenantId } = params;

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      stage: true,
      crmPriorityScore: true,
      phone: true,
      email: true,
      emailInvalid: true,
      lastContactedAt: true,
      nextTaskDue: true,
      contact: {
        include: {
          intelligence: true,
          evidence: {
            take: 5,
            orderBy: { observedAt: 'desc' },
            select: { evidenceType: true, summary: true, key: true },
          },
        },
      },
      activities: {
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { type: true, description: true, createdAt: true },
      },
    },
  });

  if (!lead) return null;

  const now = new Date();
  const sourceEvidence: string[] = [
    `Lead stage is '${lead.stage}' with priority '${lead.crmPriorityScore}'.`,
  ];

  const intel = lead.contact?.intelligence;
  const evidenceList = lead.contact?.evidence || [];

  if (intel) {
    sourceEvidence.push(`Commercial Asset Tier: ${intel.qualityClass.toUpperCase()} (Confidence: ${intel.dataConfidenceScore}%, Quality: ${intel.intrinsicQualityScore}%).`);
    if (intel.relationshipStrength) {
      sourceEvidence.push(`Relationship Strength: ${intel.relationshipStrength.toUpperCase()}.`);
    }
  }

  // 1. Commercial Intelligence Suppression / DNC check
  if (intel?.reuseStatus === 'do_not_contact' || lead.emailInvalid) {
    if (lead.phone && !intel?.reuseStatus?.includes('do_not_contact')) {
      return {
        action: 'CALL',
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`.trim(),
        company: lead.company,
        priority: 'warm',
        reason: 'Email is invalidated. Direct phone number is available for high-touch calling.',
        deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        confidence: 0.95,
        sourceEvidence: [...sourceEvidence, `Direct phone ${lead.phone} verified.`],
      };
    }
    return {
      action: 'DO_NOT_CONTACT',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'cold',
      reason: intel?.reuseStatus === 'do_not_contact'
        ? 'Contact is suppressed or opted out from outreach.'
        : 'Email is invalid and no direct phone exists. Exclude from active outreach.',
      deadline: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      confidence: 0.99,
      sourceEvidence: [...sourceEvidence, 'Suppression / DNC guard enforced.'],
    };
  }

  // 2. Client Locked or Cooldown
  if (intel?.reuseStatus === 'client_locked') {
    return {
      action: 'REVIEW',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'warm',
      reason: 'Contact is locked in an active deal with another client. Review account exclusivity.',
      deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      confidence: 0.95,
      sourceEvidence: [...sourceEvidence, 'Client lock safety guard active.'],
    };
  }

  if (intel?.reuseStatus === 'cooldown') {
    return {
      action: 'WAIT',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'cold',
      reason: `Contact under outreach cooldown until ${intel.cooldownUntil ? new Date(intel.cooldownUntil).toLocaleDateString() : 'expiry'}.`,
      deadline: intel.cooldownUntil || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      confidence: 0.9,
      sourceEvidence: [...sourceEvidence, 'Outreach cooldown window in effect.'],
    };
  }

  // 3. Replied / Engaged
  if (lead.stage === 'replied') {
    const competitorEvidence = evidenceList.find((e) => e.evidenceType === 'competitor_mentioned');
    const painEvidence = evidenceList.find((e) => e.evidenceType === 'pain_point');
    const reasonDetail = competitorEvidence
      ? `Prospect replied (${competitorEvidence.summary}). Craft tailored counter-positioning reply.`
      : painEvidence
      ? `Prospect replied (${painEvidence.summary}). Align response directly with expressed friction.`
      : 'Prospect replied to outreach. Immediate response converts 3x higher.';

    return {
      action: 'REPLY',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'hot',
      reason: reasonDetail,
      deadline: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours SLA
      confidence: 0.98,
      sourceEvidence: [...sourceEvidence, 'Stage is replied.'],
    };
  }

  // 4. Meeting Booked
  if (lead.stage === 'meeting_booked') {
    return {
      action: 'REVIEW',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'hot',
      reason: intel?.relationshipSummary || 'Meeting is scheduled. Review prospect background, company pain points, and agenda.',
      deadline: lead.nextTaskDue || new Date(now.getTime() + 24 * 60 * 60 * 1000),
      confidence: 0.95,
      sourceEvidence: [...sourceEvidence, 'Meeting booked stage active.'],
    };
  }

  // 5. Proven Champion / Executive Ready for Warm Contact
  if (intel?.qualityClass === 'proven' && lead.stage === 'new') {
    return {
      action: 'CALL',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'hot',
      reason: 'Proven executive champion asset. High-priority direct call or personalized VIP touch recommended.',
      deadline: new Date(now.getTime() + 8 * 60 * 60 * 1000),
      confidence: 0.96,
      sourceEvidence: [...sourceEvidence, 'Classified as proven high-value asset.'],
    };
  }

  // 6. Standard Sequence Active
  if (lead.stage === 'sequence_active') {
    return {
      action: 'WAIT',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'warm',
      reason: 'Sequence cadence is currently executing automated scheduled steps.',
      deadline: new Date(now.getTime() + 72 * 60 * 60 * 1000),
      confidence: 0.85,
      sourceEvidence: [...sourceEvidence, 'Cadence worker handling step progression.'],
    };
  }

  // 7. Default New Prospect
  return {
    action: 'FOLLOW_UP',
    leadId: lead.id,
    leadName: `${lead.firstName} ${lead.lastName}`.trim(),
    company: lead.company,
    priority: lead.crmPriorityScore === 'hot' || intel?.qualityClass === 'promising' ? 'hot' : 'warm',
    reason: intel?.intelligenceSummary || 'New prospect ready for outbound sequence enrollment or manual first touch.',
    deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    confidence: 0.9,
    sourceEvidence: [...sourceEvidence, 'Stage is new.'],
  };
}
