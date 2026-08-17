export type LeadPriority = 'hot' | 'warm' | 'cold';

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
  [key: string]: any;
}

/**
 * Canonical deterministic lead scorer (Phase 8a)
 */
export function scoreLead(lead: ScoreLeadInput): ScoreLeadResult {
  let score = 20; // baseline
  const insights: string[] = [];

  // Stage evaluation
  if (lead.stage === 'meeting_booked' || lead.stage === 'won') {
    score += 40;
    insights.push('High value conversion stage');
  } else if (lead.stage === 'replied') {
    score += 30;
    insights.push('Prospect engaged / replied');
  } else if (lead.stage === 'sequence_active') {
    score += 15;
    insights.push('Active in outreach sequence');
  } else if (lead.stage === 'lost') {
    score = Math.min(score, 10);
    insights.push('Lead marked lost');
  }

  // Priority metadata bonus
  if (lead.crmPriorityScore === 'hot') {
    score += 20;
    insights.push('SDR tagged as Hot priority');
  } else if (lead.crmPriorityScore === 'warm') {
    score += 10;
  }

  // Seniority & Title
  const title = (lead.title || '').toLowerCase();
  if (/chief|ceo|cfo|cto|cro|cmo|coo|founder|president|owner/i.test(title)) {
    score += 20;
    insights.push('C-Level / Executive Decision Maker');
  } else if (/vp|vice president|director|head of/i.test(title)) {
    score += 12;
    insights.push('Director / VP Management Seniority');
  }

  // Contact completeness
  let channels = 0;
  if (lead.email && lead.email.includes('@') && !lead.emailInvalid) channels++;
  if (lead.phone && lead.phone.trim().length > 3) channels++;
  if (lead.linkedIn) channels++;
  if (lead.whatsApp) channels++;

  if (channels >= 3) {
    score += 15;
    insights.push('Multi-channel contact data verified');
  } else if (channels >= 2) {
    score += 8;
  }

  // Activity recency
  if (lead.lastContactedAt) {
    const hours = (Date.now() - new Date(lead.lastContactedAt).getTime()) / (1000 * 3600);
    if (hours < 72) {
      score += 10;
      insights.push('Recently contacted (< 72h)');
    }
  }

  // Deduct for overdue pending tasks (-4 each)
  if (Array.isArray(lead.tasks)) {
    const now = Date.now();
    const overdueCount = lead.tasks.filter(
      (t) => t.status === 'pending' && t.dueDate && new Date(t.dueDate).getTime() < now
    ).length;
    if (overdueCount > 0) {
      const penalty = overdueCount * 4;
      score -= penalty;
      insights.push(`${overdueCount} overdue task(s) pending (-${penalty} pts)`);
    }
  }

  // Clamping
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Label calculation
  let label: LeadPriority = 'cold';
  if (score >= 60) label = 'hot';
  else if (score >= 35) label = 'warm';

  // Recommendation text
  let recommendation = 'Monitor for next sequence step or touchpoint.';
  if (label === 'hot') {
    recommendation = 'High priority: Execute direct phone follow-up or book demo.';
  } else if (label === 'warm') {
    recommendation = 'Warm engagement: Send targeted value-add email or case study.';
  }

  return {
    score,
    label,
    insights,
    recommendation,
  };
}

// ─── Custom Configurable Scoring Engine ──────────────────────────────────────

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

export const DEFAULT_SCORING_RULES: LeadScoringRules = {
  titleCLevelWeight: 25,
  titleDirectorWeight: 15,
  emailOpenWeight: 5,
  emailReplyWeight: 30,
  meetingBookedWeight: 40,
  verifiedEmailWeight: 10,
  phonePresentWeight: 10,
  bouncedPenalty: -50,
  hotThreshold: 65,
  warmThreshold: 35,
};

export interface LeadScoreInput {
  title?: string | null;
  emailSentCount?: number;
  emailOpenCount?: number;
  emailReplyCount?: number;
  emailInvalid?: boolean;
  emailValidation?: string | null;
  phone?: string | null;
  meetingCount?: number;
}

export interface CalculatedLeadScore {
  score: number;
  priority: LeadPriority;
  breakdown: Array<{ factor: string; points: number }>;
}

export function calculateLeadScore(
  lead: LeadScoreInput,
  rules: LeadScoringRules = DEFAULT_SCORING_RULES
): CalculatedLeadScore {
  let score = 0;
  const breakdown: Array<{ factor: string; points: number }> = [];

  const title = (lead.title || '').toLowerCase();
  if (/chief|ceo|cfo|cto|cro|cmo|coo|founder|co-founder|president|owner|partner/i.test(title)) {
    score += rules.titleCLevelWeight;
    breakdown.push({ factor: 'C-Level / Executive Title', points: rules.titleCLevelWeight });
  } else if (/vp|vice president|director|head of|lead/i.test(title)) {
    score += rules.titleDirectorWeight;
    breakdown.push({ factor: 'Director / Management Title', points: rules.titleDirectorWeight });
  }

  const opens = Math.min(lead.emailOpenCount || 0, 4);
  if (opens > 0) {
    const openPoints = opens * rules.emailOpenWeight;
    score += openPoints;
    breakdown.push({ factor: `${opens} Email Open(s)`, points: openPoints });
  }

  if ((lead.emailReplyCount || 0) > 0) {
    score += rules.emailReplyWeight;
    breakdown.push({ factor: 'Inbound Email Reply Received', points: rules.emailReplyWeight });
  }

  if ((lead.meetingCount || 0) > 0) {
    score += rules.meetingBookedWeight;
    breakdown.push({ factor: 'Meeting Scheduled / Completed', points: rules.meetingBookedWeight });
  }

  if (lead.emailValidation === 'valid' || (!lead.emailInvalid && lead.emailValidation !== 'invalid')) {
    score += rules.verifiedEmailWeight;
    breakdown.push({ factor: 'Deliverable Email Verified', points: rules.verifiedEmailWeight });
  }

  if (lead.phone && lead.phone.trim().length > 5) {
    score += rules.phonePresentWeight;
    breakdown.push({ factor: 'Direct Phone Available', points: rules.phonePresentWeight });
  }

  if (lead.emailInvalid || lead.emailValidation === 'invalid' || lead.emailValidation === 'bounced') {
    score += rules.bouncedPenalty;
    breakdown.push({ factor: 'Email Bounced / Invalid', points: rules.bouncedPenalty });
  }

  const normalizedScore = Math.max(0, Math.min(100, score));

  let priority: LeadPriority = 'cold';
  if (normalizedScore >= rules.hotThreshold) {
    priority = 'hot';
  } else if (normalizedScore >= rules.warmThreshold) {
    priority = 'warm';
  }

  return {
    score: normalizedScore,
    priority,
    breakdown,
  };
}
