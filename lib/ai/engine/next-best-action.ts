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

  // 1. Suppressed or invalid email
  if (lead.emailInvalid) {
    if (lead.phone) {
      return {
        action: 'CALL',
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`.trim(),
        company: lead.company,
        priority: 'warm',
        reason: 'Email is suppressed/invalidated. Phone is available for direct calling outreach.',
        deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        confidence: 0.95,
        sourceEvidence: [...sourceEvidence, `Email marked invalid. Phone ${lead.phone} present.`],
      };
    }
    return {
      action: 'RESEARCH',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'cold',
      reason: 'Email is invalid and no phone number exists. Re-enrich prospect contact data.',
      deadline: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      confidence: 0.9,
      sourceEvidence: [...sourceEvidence, 'Missing valid phone and email.'],
    };
  }

  // 2. Replied / Engaged
  if (lead.stage === 'replied') {
    return {
      action: 'REPLY',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'hot',
      reason: 'Prospect replied to outreach. Immediate response converts 3x higher.',
      deadline: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours SLA
      confidence: 0.98,
      sourceEvidence: [...sourceEvidence, 'Stage is replied.'],
    };
  }

  // 3. Meeting Booked
  if (lead.stage === 'meeting_booked') {
    return {
      action: 'REVIEW',
      leadId: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      company: lead.company,
      priority: 'hot',
      reason: 'Meeting is scheduled. Review prospect background, company pain points, and agenda.',
      deadline: lead.nextTaskDue || new Date(now.getTime() + 24 * 60 * 60 * 1000),
      confidence: 0.95,
      sourceEvidence: [...sourceEvidence, 'Meeting booked stage active.'],
    };
  }

  // 4. Standard Sequence Active
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

  // 5. Default New Prospect
  return {
    action: 'FOLLOW_UP',
    leadId: lead.id,
    leadName: `${lead.firstName} ${lead.lastName}`.trim(),
    company: lead.company,
    priority: lead.crmPriorityScore === 'hot' ? 'hot' : 'warm',
    reason: 'New prospect ready for outbound sequence enrollment or manual first touch.',
    deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    confidence: 0.9,
    sourceEvidence: [...sourceEvidence, 'Stage is new.'],
  };
}
