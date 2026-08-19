/**
 * Telestar Meeting Quality Engine & Client Feedback Loop (Directive Phase 9 §42, §43, §44).
 */

export type MeetingLifecycleStage =
  | 'BOOKED'
  | 'ATTENDED'
  | 'CLIENT_ACCEPTED'
  | 'QUALIFIED'
  | 'OPPORTUNITY_CREATED'
  | 'WON';

export type ClientFeedbackGrade =
  | 'EXCELLENT'
  | 'GOOD'
  | 'MARGINAL'
  | 'REJECTED'
  | 'NO_SHOW'
  | 'WRONG_PERSONA'
  | 'WRONG_COMPANY'
  | 'INSUFFICIENT_INTEREST'
  | 'OTHER';

export interface MeetingQualityRecord {
  meetingId: string;
  campaignId: string;
  leadId: string;
  sdrId: string;
  lifecycleStage: MeetingLifecycleStage;
  clientFeedbackGrade?: ClientFeedbackGrade | null;
  clientFeedbackNotes?: string | null;
  personaFitVerified: boolean;
  companyFitVerified: boolean;
  budgetDiscussed: boolean;
  timelineDiscussed: boolean;
  painPointsIdentified: string[];
  opportunityValueUsd?: number | null;
  qualityScore: number; // 0 to 100
}

export function evaluateMeetingQuality(record: {
  attended: boolean;
  feedbackGrade?: ClientFeedbackGrade | null;
  personaFit: boolean;
  companyFit: boolean;
  painPointsCount: number;
  opportunityCreated: boolean;
}): { qualityScore: number; qualityClass: 'HIGH' | 'ACCEPTABLE' | 'LOW' | 'REJECTED'; summary: string } {
  if (!record.attended) {
    return { qualityScore: 0, qualityClass: 'REJECTED', summary: 'No Show / Unattended meeting.' };
  }

  if (
    record.feedbackGrade === 'REJECTED' ||
    record.feedbackGrade === 'WRONG_PERSONA' ||
    record.feedbackGrade === 'WRONG_COMPANY'
  ) {
    return {
      qualityScore: 15,
      qualityClass: 'REJECTED',
      summary: `Rejected by client (${record.feedbackGrade}). Fails targeting criteria.`,
    };
  }

  let score = 50; // base for attended meeting

  if (record.feedbackGrade === 'EXCELLENT') score += 30;
  else if (record.feedbackGrade === 'GOOD') score += 20;
  else if (record.feedbackGrade === 'MARGINAL') score += 5;

  if (record.personaFit) score += 10;
  if (record.companyFit) score += 5;
  if (record.painPointsCount > 0) score += 5;

  const finalScore = Math.min(100, score);
  let qualityClass: 'HIGH' | 'ACCEPTABLE' | 'LOW' | 'REJECTED' = 'ACCEPTABLE';

  if (finalScore >= 80) qualityClass = 'HIGH';
  else if (finalScore < 55) qualityClass = 'LOW';

  return {
    qualityScore: finalScore,
    qualityClass,
    summary: `Quality Score: ${finalScore}/100 (${qualityClass}). Client Feedback: ${record.feedbackGrade || 'Pending'}.`,
  };
}
