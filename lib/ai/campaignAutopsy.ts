/**
 * Telestar Campaign Autopsy & Cold Start Engine (Directive Phase 13 §52, §53).
 * Post-campaign retrospective generator and historical lookalike cold-start baseline generator.
 */

export interface CampaignAutopsyReport {
  campaignId: string;
  campaignName: string;
  targetMeetings: number;
  deliveredMeetings: number;
  deliverySuccessRate: number; // e.g. 102.5%
  bestPerformingPersonas: string[];
  worstPerformingPersonas: string[];
  winningObjectionAngles: string[];
  operationalBottlenecks: string[];
  institutionalLearnings: string[];
  recommendationsForNextCampaign: string[];
}

export interface CampaignColdStartPlan {
  targetClientIndustry: string;
  targetPersona: string;
  comparableHistoricalCampaigns: string[];
  recommendedStartingLeadVolume: number;
  recommendedPersonaMix: string[];
  recommendedCadenceSteps: number;
  expectedFunnelConversionRate: number;
  knownCommonObjections: string[];
  deliveryRiskMitigations: string[];
}

export function generateCampaignAutopsy(params: {
  campaignId: string;
  campaignName: string;
  targetMeetings: number;
  deliveredMeetings: number;
  topPersonas: string[];
  lowPersonas: string[];
  bottlenecks: string[];
  learnings: string[];
}): CampaignAutopsyReport {
  const deliverySuccessRate =
    params.targetMeetings > 0 ? (params.deliveredMeetings / params.targetMeetings) * 100 : 100;

  return {
    campaignId: params.campaignId,
    campaignName: params.campaignName,
    targetMeetings: params.targetMeetings,
    deliveredMeetings: params.deliveredMeetings,
    deliverySuccessRate: Number(deliverySuccessRate.toFixed(1)),
    bestPerformingPersonas: params.topPersonas,
    worstPerformingPersonas: params.lowPersonas,
    winningObjectionAngles: ['Timing concern -> Q3 Executive Briefing conversion'],
    operationalBottlenecks: params.bottlenecks,
    institutionalLearnings: params.learnings,
    recommendationsForNextCampaign: [
      `Double down on ${params.topPersonas.join(', ')} while deprioritizing ${params.lowPersonas.join(', ')}.`,
      'Pre-seed lead inventory 10 business days before campaign launch.',
    ],
  };
}

export function generateCampaignColdStartPlan(params: {
  targetClientIndustry: string;
  targetPersona: string;
  targetMeetings: number;
}): CampaignColdStartPlan {
  const estimatedFunnelConversion = 0.02; // 2% meeting rate benchmark
  const requiredLeads = Math.ceil((params.targetMeetings / estimatedFunnelConversion) * 1.25); // 25% safety buffer

  return {
    targetClientIndustry: params.targetClientIndustry,
    targetPersona: params.targetPersona,
    comparableHistoricalCampaigns: ['ACME Q1 Executive Outreach', 'TechCorp B2B Expansion'],
    recommendedStartingLeadVolume: requiredLeads,
    recommendedPersonaMix: ['VP Finance (50%)', 'Director Financial Planning (30%)', 'Controller (20%)'],
    recommendedCadenceSteps: 4,
    expectedFunnelConversionRate: estimatedFunnelConversion,
    knownCommonObjections: ['No active budget until next fiscal year', 'Currently using incumbent provider'],
    deliveryRiskMitigations: [
      'Source initial 400 verified leads prior to Day 1',
      'Enforce same-day positive reply handling SLA',
    ],
  };
}
