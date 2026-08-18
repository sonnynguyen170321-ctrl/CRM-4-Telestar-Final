import type { ContactScoreBreakdown } from './types';

export const SCORING_VERSION = 'v1.0';

export function calculateIntrinsicQualityScore(contact: {
  seniority?: string | null;
  title?: string | null;
  email?: string | null;
  emailValidation?: string | null;
  phone?: string | null;
  linkedIn?: string | null;
  company?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): ContactScoreBreakdown {
  let score = 0;
  const factors: ContactScoreBreakdown['factors'] = [];

  const seniority = (contact.seniority || '').toLowerCase();
  const title = (contact.title || '').toLowerCase();

  if (
    seniority.includes('c-level') ||
    seniority.includes('cxo') ||
    seniority.includes('vp') ||
    seniority.includes('director') ||
    title.includes('chief') ||
    title.includes('vp') ||
    title.includes('director') ||
    title.includes('head of')
  ) {
    score += 30;
    factors.push({ label: 'Seniority Level', impact: 30, description: 'Executive or Director level decision maker' });
  } else if (
    seniority.includes('manager') ||
    seniority.includes('lead') ||
    title.includes('manager') ||
    title.includes('lead')
  ) {
    score += 20;
    factors.push({ label: 'Seniority Level', impact: 20, description: 'Management level stakeholder' });
  } else if (title) {
    score += 10;
    factors.push({ label: 'Seniority Level', impact: 10, description: 'Individual contributor or specialist' });
  }

  const emailVal = (contact.emailValidation || '').toLowerCase();
  if (emailVal === 'deliverable' || emailVal === 'valid' || emailVal === 'verified') {
    score += 25;
    factors.push({ label: 'Verified Email', impact: 25, description: 'Direct work email verified deliverable' });
  } else if (contact.email) {
    score += 15;
    factors.push({ label: 'Work Email', impact: 15, description: 'Work email provided but unverified' });
  }

  if (contact.phone) {
    score += 15;
    factors.push({ label: 'Direct Phone', impact: 15, description: 'Phone number available' });
  }

  if (contact.linkedIn) {
    score += 15;
    factors.push({ label: 'LinkedIn Profile', impact: 15, description: 'LinkedIn profile available' });
  }

  if (contact.firstName && contact.lastName && contact.company) {
    score += 15;
    factors.push({ label: 'Complete Identity Profile', impact: 15, description: 'Full name and company name present' });
  }

  const finalScore = Math.min(100, Math.max(0, score));
  return { score: finalScore, factors };
}

export function calculateDataConfidenceScore(params: {
  emailValidation?: string | null;
  emailScore?: number | null;
  hasPhone: boolean;
  hasLinkedIn: boolean;
  humanConfirmedCount: number;
  lastVerifiedAt?: Date | null;
}): ContactScoreBreakdown {
  let score = 0;
  const factors: ContactScoreBreakdown['factors'] = [];

  const val = (params.emailValidation || '').toLowerCase();
  if (val === 'deliverable' || val === 'valid' || val === 'verified') {
    score += 40;
    factors.push({ label: 'Email Deliverability', impact: 40, description: 'Email explicitly verified as deliverable' });
  } else if (val === 'risky' || val === 'catch_all') {
    score += 20;
    factors.push({ label: 'Email Deliverability', impact: 20, description: 'Email validation indicates risky / catch-all domain' });
  } else if (val === 'undeliverable' || val === 'invalid') {
    score += 0;
    factors.push({ label: 'Email Deliverability', impact: 0, description: 'Email validation marked as undeliverable/invalid' });
  } else {
    score += 15;
    factors.push({ label: 'Email Format', impact: 15, description: 'Standard formatted email address' });
  }

  if (params.hasPhone && params.hasLinkedIn) {
    score += 25;
    factors.push({ label: 'Multi-Channel Verified', impact: 25, description: 'Phone and LinkedIn accounts both available' });
  } else if (params.hasPhone || params.hasLinkedIn) {
    score += 15;
    factors.push({ label: 'Multi-Channel Data', impact: 15, description: 'Secondary contact channel available' });
  }

  if (params.humanConfirmedCount > 0) {
    const impact = Math.min(20, params.humanConfirmedCount * 10);
    score += impact;
    factors.push({ label: 'Human Verified Evidence', impact, description: `${params.humanConfirmedCount} human-confirmed evidence facts` });
  }

  if (params.lastVerifiedAt) {
    const days = (Date.now() - params.lastVerifiedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 30) {
      score += 15;
      factors.push({ label: 'Recent Verification', impact: 15, description: 'Verified within the last 30 days' });
    } else if (days <= 90) {
      score += 10;
      factors.push({ label: 'Verification Recency', impact: 10, description: 'Verified within the last 90 days' });
    } else if (days <= 180) {
      score += 5;
      factors.push({ label: 'Verification Recency', impact: 5, description: 'Verified within the last 180 days' });
    }
  }

  const finalScore = Math.min(100, Math.max(0, score));
  return { score: finalScore, factors };
}

export function calculateEngagementScore(counts: {
  touchCount: number;
  replyCount: number;
  meaningfulReplyCount: number;
  positiveReplyCount: number;
  meetingBookedCount: number;
  referralGivenCount: number;
  hasUnsubscribedOrDnc: boolean;
}): ContactScoreBreakdown {
  if (counts.hasUnsubscribedOrDnc) {
    return {
      score: 0,
      factors: [{ label: 'Suppression / Opt-Out', impact: -100, description: 'Prospect requested opt-out or DNC' }],
    };
  }

  let score = 0;
  const factors: ContactScoreBreakdown['factors'] = [];

  if (counts.positiveReplyCount > 0) {
    const impact = Math.min(40, counts.positiveReplyCount * 30);
    score += impact;
    factors.push({ label: 'Positive Replies', impact, description: `${counts.positiveReplyCount} positive conversation responses` });
  }

  if (counts.meaningfulReplyCount > 0) {
    const impact = Math.min(25, counts.meaningfulReplyCount * 15);
    score += impact;
    factors.push({ label: 'Substantive Replies', impact, description: `${counts.meaningfulReplyCount} substantive replies or notes` });
  } else if (counts.replyCount > 0) {
    score += 15;
    factors.push({ label: 'Replies', impact: 15, description: 'Standard reply received' });
  }

  if (counts.meetingBookedCount > 0) {
    const impact = Math.min(30, counts.meetingBookedCount * 25);
    score += impact;
    factors.push({ label: 'Meetings Booked', impact, description: `${counts.meetingBookedCount} sales meetings scheduled` });
  }

  if (counts.referralGivenCount > 0) {
    score += 15;
    factors.push({ label: 'Internal Referral', impact: 15, description: 'Provided referral to colleague' });
  }

  if (counts.touchCount > 0 && counts.replyCount === 0 && counts.meetingBookedCount === 0) {
    factors.push({ label: 'Unresponsive Outreaches', impact: 0, description: `${counts.touchCount} touches with no response yet` });
  }

  const finalScore = Math.min(100, Math.max(0, score));
  return { score: finalScore, factors };
}

export function calculateRelationshipScore(params: {
  hasOwner: boolean;
  relationshipStrength?: string | null;
  relationshipType?: string | null;
  meetingCompletedCount: number;
  acceptedOpportunityCount: number;
  wonOpportunityCount: number;
}): ContactScoreBreakdown {
  let score = 0;
  const factors: ContactScoreBreakdown['factors'] = [];

  if (params.wonOpportunityCount > 0) {
    const impact = Math.min(40, params.wonOpportunityCount * 35);
    score += impact;
    factors.push({ label: 'Closed Deals', impact, description: `${params.wonOpportunityCount} closed-won commercial deals` });
  }

  if (params.acceptedOpportunityCount > 0) {
    const impact = Math.min(30, params.acceptedOpportunityCount * 20);
    score += impact;
    factors.push({ label: 'Qualified Pipeline Opportunities', impact, description: `${params.acceptedOpportunityCount} sales accepted opportunities` });
  }

  if (params.meetingCompletedCount > 0) {
    const impact = Math.min(25, params.meetingCompletedCount * 20);
    score += impact;
    factors.push({ label: 'Completed Meetings', impact, description: `${params.meetingCompletedCount} completed meetings` });
  }

  if (params.hasOwner) {
    score += 15;
    factors.push({ label: 'Dedicated Relationship Owner', impact: 15, description: 'Named relationship owner actively managing contact' });
  }

  const strength = (params.relationshipStrength || '').toLowerCase();
  if (strength === 'champion') {
    score += 20;
    factors.push({ label: 'Champion Advocate', impact: 20, description: 'Internal champion driving commercial engagement' });
  } else if (strength === 'strong') {
    score += 15;
    factors.push({ label: 'Strong Relationship', impact: 15, description: 'Established warm rapport and direct accessibility' });
  } else if (strength === 'normal') {
    score += 10;
    factors.push({ label: 'Established Relationship', impact: 10, description: 'Recognized conversational relationship' });
  }

  const finalScore = Math.min(100, Math.max(0, score));
  return { score: finalScore, factors };
}

export function calculateFreshnessScore(lastActivityDate: Date | null): ContactScoreBreakdown {
  if (!lastActivityDate) {
    return {
      score: 10,
      factors: [{ label: 'No Recent Observations', impact: 10, description: 'No recorded interactions or verifications' }],
    };
  }

  const days = Math.max(0, (Date.now() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24));
  let score = 100;
  let description = '';

  if (days <= 30) {
    score = 100;
    description = `Verified or engaged within the past ${Math.round(days)} days (Active)`;
  } else if (days <= 60) {
    score = 85;
    description = `Last active ${Math.round(days)} days ago (Fresh)`;
  } else if (days <= 90) {
    score = 70;
    description = `Last active ${Math.round(days)} days ago (Moderate)`;
  } else if (days <= 180) {
    score = 45;
    description = `Last active ${Math.round(days)} days ago (Aging)`;
  } else if (days <= 365) {
    score = 20;
    description = `Last active ${Math.round(days)} days ago (Needs Refresh)`;
  } else {
    score = 5;
    description = `Last active >1 year ago (Stale)`;
  }

  return {
    score,
    factors: [{ label: 'Activity Recency', impact: score, description }],
  };
}
