export type LeadPriority = "hot" | "warm" | "cold";
export type EngagementReason =
  "meeting_booked" | "reply_received" | "email_opened" | "no_engagement";
export const ENGAGEMENT_SIGNAL_VALUES = Object.freeze({
  meeting: 100,
  reply: 80,
  open: 10,
  maxOpens: 4,
});

export interface ScoreLeadResult {
  score: number;
  label: LeadPriority;
  insights: string[];
  recommendation: string;
}

export interface ScoreLeadInput {
  id?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string | null;
  phone?: string | null;
  linkedIn?: string | null;
  whatsApp?: string | null;
  title?: string | null;
  stage?: string;
  crmPriorityScore?: string;
  source?: string | null;
  lastContactedAt?: string | Date | null;
  createdAt?: string | Date;
  emailSentCount?: number;
  emailOpenCount?: number;
  emailReplyCount?: number;
  emailInvalid?: boolean;
  emailValidation?: string | null;
  nextTaskDue?: string | Date | null;
  tags?: string[];
  tasks?: Array<{
    status?: string;
    dueDate?: string | Date | null;
  }>;
  meetings?: Array<{
    id?: string;
    status?: string;
  }>;
  meetingCount?: number;
  [key: string]: any;
}

/**
 * Fixed, explainable engagement ladder.
 *
 * ICP fit, title, contactability and task state deliberately do not participate. They answer
 * different questions and belong in their own views. Precedence makes the score stable:
 * meeting > reply > opens > no engagement.
 */
export function calculateEngagement(lead: ScoreLeadInput): CalculatedLeadScore {
  const meetingCount = lead.meetingCount ?? lead.meetings?.length ?? 0;
  if (meetingCount > 0) {
    return {
      score: ENGAGEMENT_SIGNAL_VALUES.meeting,
      priority: "hot",
      reason: "meeting_booked",
      breakdown: [
        { factor: "Meeting booked", points: ENGAGEMENT_SIGNAL_VALUES.meeting },
      ],
    };
  }

  if ((lead.emailReplyCount ?? 0) > 0) {
    return {
      score: ENGAGEMENT_SIGNAL_VALUES.reply,
      priority: "hot",
      reason: "reply_received",
      breakdown: [
        { factor: "Reply received", points: ENGAGEMENT_SIGNAL_VALUES.reply },
      ],
    };
  }

  const opens = Math.min(
    Math.max(lead.emailOpenCount ?? 0, 0),
    ENGAGEMENT_SIGNAL_VALUES.maxOpens,
  );
  if (opens > 0) {
    const score = opens * ENGAGEMENT_SIGNAL_VALUES.open;
    return {
      score,
      priority: "warm",
      reason: "email_opened",
      breakdown: [{ factor: `${opens} email open(s)`, points: score }],
    };
  }

  return { score: 0, priority: "cold", reason: "no_engagement", breakdown: [] };
}

/**
 * Compatibility adapter for consumers that still ask for a recommendation.
 * The numeric value is engagement only; this function no longer produces a blended lead score.
 */
export function scoreLead(lead: ScoreLeadInput): ScoreLeadResult {
  const engagement = calculateEngagement(lead);
  const copy: Record<
    EngagementReason,
    { insight: string | null; recommendation: string }
  > = {
    meeting_booked: {
      insight: "Meeting booked",
      recommendation: "Prepare for the meeting and confirm the next step.",
    },
    reply_received: {
      insight: "Prospect replied",
      recommendation: "Review the reply and follow up personally.",
    },
    email_opened: {
      insight: "Prospect opened outreach",
      recommendation:
        "Continue the planned cadence; interest is not confirmed yet.",
    },
    no_engagement: {
      insight: null,
      recommendation:
        "Continue the planned cadence and monitor for engagement.",
    },
  };
  return {
    score: engagement.score,
    label: engagement.priority,
    insights: copy[engagement.reason].insight
      ? [copy[engagement.reason].insight as string]
      : [],
    recommendation: copy[engagement.reason].recommendation,
  };
}

/**
 * Legacy transport shape retained until the Automation UI is migrated. Values are fixed and PUT
 * cannot change them. Zeroed fields make it explicit that fit/contact data is not engagement.
 */
export interface LeadScoringRules {
  titleCLevelWeight: number;
  titleDirectorWeight: number;
  emailOpenWeight: number;
  emailReplyWeight: number;
  meetingBookedWeight: number;
  verifiedEmailWeight: number;
  phonePresentWeight: number;
  bouncedPenalty: number;
  hotThreshold: number;
  warmThreshold: number;
}

export const DEFAULT_SCORING_RULES: Readonly<LeadScoringRules> = Object.freeze({
  titleCLevelWeight: 0,
  titleDirectorWeight: 0,
  emailOpenWeight: ENGAGEMENT_SIGNAL_VALUES.open,
  emailReplyWeight: ENGAGEMENT_SIGNAL_VALUES.reply,
  meetingBookedWeight: ENGAGEMENT_SIGNAL_VALUES.meeting,
  verifiedEmailWeight: 0,
  phonePresentWeight: 0,
  bouncedPenalty: 0,
  hotThreshold: ENGAGEMENT_SIGNAL_VALUES.reply,
  warmThreshold: ENGAGEMENT_SIGNAL_VALUES.open,
});

export type LeadScoreInput = ScoreLeadInput;

export interface CalculatedLeadScore {
  score: number;
  priority: LeadPriority;
  reason: EngagementReason;
  breakdown: Array<{ factor: string; points: number }>;
}

/** @deprecated Use calculateEngagement. The second argument is ignored because rules are fixed. */
export function calculateLeadScore(
  lead: LeadScoreInput,
  _rules: LeadScoringRules = DEFAULT_SCORING_RULES,
): CalculatedLeadScore {
  return calculateEngagement(lead);
}
