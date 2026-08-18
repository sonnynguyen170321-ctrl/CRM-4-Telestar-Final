import type { ContactScoreBreakdown } from './types';

export type ContactIntelligenceExplainability = {
  overallAssessment: string;
  keyStrengths: string[];
  riskFactors: string[];
  recommendedAction: string;
  scoringBreakdowns: {
    intrinsicQuality: ContactScoreBreakdown;
    dataConfidence: ContactScoreBreakdown;
    engagement: ContactScoreBreakdown;
    relationship: ContactScoreBreakdown;
    freshness: ContactScoreBreakdown;
  };
};

export function buildContactExplainability(params: {
  qualityBreakdown: ContactScoreBreakdown;
  confidenceBreakdown: ContactScoreBreakdown;
  engagementBreakdown: ContactScoreBreakdown;
  relationshipBreakdown: ContactScoreBreakdown;
  freshnessBreakdown: ContactScoreBreakdown;
  reuseReasons: string[];
  qualityClass: string;
  reuseStatus: string;
}): ContactIntelligenceExplainability {
  const keyStrengths: string[] = [];
  const riskFactors: string[] = [];

  // Evaluate strengths
  if (params.qualityBreakdown.score >= 70) {
    keyStrengths.push('High intrinsic profile quality with verified executive or managerial decision-maker title.');
  }
  if (params.confidenceBreakdown.score >= 70) {
    keyStrengths.push('High confidence multi-channel verified contact information.');
  }
  if (params.engagementBreakdown.score >= 50) {
    keyStrengths.push('Demonstrated positive commercial engagement history.');
  }
  if (params.relationshipBreakdown.score >= 50) {
    keyStrengths.push('Established commercial relationship with completed meeting / opportunity history.');
  }

  // Evaluate risks
  if (params.freshnessBreakdown.score <= 30) {
    riskFactors.push('Contact information is aging and may require email validation / role reverification.');
  }
  if (params.confidenceBreakdown.score <= 40) {
    riskFactors.push('Unverified direct email or missing secondary channel.');
  }
  if (params.reuseStatus === 'cooldown') {
    riskFactors.push('Currently protected under campaign outreach cooldown.');
  } else if (params.reuseStatus === 'client_locked') {
    riskFactors.push('Active deal in progress — client exclusive lock active.');
  }

  let overallAssessment = 'Standard untested contact profile.';
  let recommendedAction = 'Ready for initial campaign prospecting.';

  if (params.qualityClass === 'proven') {
    overallAssessment = 'Proven commercial asset with confirmed positive deal or meeting outcomes.';
    recommendedAction = 'Prioritize for executive outreach or warm relationship routing.';
  } else if (params.qualityClass === 'promising') {
    overallAssessment = 'High-confidence decision-maker target matching premium ICP parameters.';
    recommendedAction = 'Enroll in tailored multi-touch cadence.';
  } else if (params.qualityClass === 'weak') {
    overallAssessment = 'Low-confidence data profile requiring enrichment.';
    recommendedAction = 'Enrich contact channels and verify title before deploying SDR capacity.';
  } else if (params.qualityClass === 'invalid') {
    overallAssessment = 'Suppressed or invalid data profile.';
    recommendedAction = 'Do not contact. Keep on suppression/DNC list.';
  }

  return {
    overallAssessment,
    keyStrengths: keyStrengths.length > 0 ? keyStrengths : ['Basic contact information recorded.'],
    riskFactors: riskFactors.length > 0 ? riskFactors : ['No major operational risks identified.'],
    recommendedAction,
    scoringBreakdowns: {
      intrinsicQuality: params.qualityBreakdown,
      dataConfidence: params.confidenceBreakdown,
      engagement: params.engagementBreakdown,
      relationship: params.relationshipBreakdown,
      freshness: params.freshnessBreakdown,
    },
  };
}
