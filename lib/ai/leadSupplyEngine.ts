/**
 * Telestar Lead Supply Chain & Intelligent Matching Engine
 * (Directive Phase 8 §39, §40, §41).
 */

export interface LeadMatchingCriteria {
  targetPersona: string;
  targetIndustries: string[];
  targetSeniority: string[];
  targetGeographies: string[];
}

export interface CandidateLeadProfile {
  id: string;
  fullName: string;
  title: string;
  seniority: string;
  industry: string;
  country: string;
  emailDeliverable: boolean;
  hasPhone: boolean;
  hasLinkedIn: boolean;
  priorPositiveEngagement: boolean;
  isClientLocked: boolean;
  isSuppressed: boolean;
}

export interface LeadMatchScoreResult {
  candidateId: string;
  score: number; // 0 to 100
  qualified: boolean;
  factors: { category: string; passed: boolean; weight: number; explanation: string }[];
  matchSummary: string;
}

export function evaluateLeadMatch(
  lead: CandidateLeadProfile,
  criteria: LeadMatchingCriteria
): LeadMatchScoreResult {
  // Safety checks (Directive §40)
  if (lead.isSuppressed || lead.isClientLocked) {
    return {
      candidateId: lead.id,
      score: 0,
      qualified: false,
      factors: [
        {
          category: 'Safety & Compliance',
          passed: false,
          weight: 100,
          explanation: lead.isSuppressed ? 'Contact is suppressed or opted out' : 'Contact locked to active client deal',
        },
      ],
      matchSummary: 'Rejected: Fails compliance or client conflict safety rules.',
    };
  }

  const factors: { category: string; passed: boolean; weight: number; explanation: string }[] = [];
  let totalScore = 0;

  // 1. Persona / Seniority Fit (35 points)
  const seniorityMatch = criteria.targetSeniority.some((s) => lead.seniority.toLowerCase().includes(s.toLowerCase()));
  const personaMatch = criteria.targetPersona.toLowerCase().split(' ').some((w) => lead.title.toLowerCase().includes(w));
  const personaPoints = seniorityMatch && personaMatch ? 35 : seniorityMatch || personaMatch ? 20 : 5;
  totalScore += personaPoints;
  factors.push({
    category: 'Persona & Seniority',
    passed: personaPoints >= 20,
    weight: personaPoints,
    explanation: `${lead.title} (${lead.seniority}) matches target criteria.`,
  });

  // 2. Industry & Geography Fit (25 points)
  const industryMatch = criteria.targetIndustries.some((ind) => lead.industry.toLowerCase().includes(ind.toLowerCase()));
  const geoMatch = criteria.targetGeographies.some((geo) => lead.country.toLowerCase().includes(geo.toLowerCase()));
  const marketPoints = (industryMatch ? 15 : 0) + (geoMatch ? 10 : 0);
  totalScore += marketPoints;
  factors.push({
    category: 'Industry & Geography',
    passed: marketPoints >= 15,
    weight: marketPoints,
    explanation: `${lead.industry} in ${lead.country}.`,
  });

  // 3. Channel Verification & Data Confidence (20 points)
  let channelPoints = 0;
  if (lead.emailDeliverable) channelPoints += 12;
  if (lead.hasPhone) channelPoints += 4;
  if (lead.hasLinkedIn) channelPoints += 4;
  totalScore += channelPoints;
  factors.push({
    category: 'Data Confidence',
    passed: channelPoints >= 12,
    weight: channelPoints,
    explanation: lead.emailDeliverable ? 'Verified deliverable business email.' : 'Unverified email channel.',
  });

  // 4. Prior Relationship Capital (20 points)
  const relationshipPoints = lead.priorPositiveEngagement ? 20 : 10;
  totalScore += relationshipPoints;
  factors.push({
    category: 'Relationship History',
    passed: lead.priorPositiveEngagement,
    weight: relationshipPoints,
    explanation: lead.priorPositiveEngagement
      ? 'Prior positive Telestar engagement recorded.'
      : 'Fresh uncontacted profile.',
  });

  const finalScore = Math.min(100, totalScore);
  const qualified = finalScore >= 65;

  const passedHighlights = factors.filter((f) => f.passed).map((f) => f.explanation).join(' ');
  const matchSummary = `${finalScore}/100 — ${passedHighlights || 'Standard qualification parameters.'}`;

  return {
    candidateId: lead.id,
    score: finalScore,
    qualified,
    factors,
    matchSummary,
  };
}
