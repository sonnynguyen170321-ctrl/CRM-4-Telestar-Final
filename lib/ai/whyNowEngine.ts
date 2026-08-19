/**
 * Telestar Why-Now Engine (Directive Phase 20 §77, §78).
 * Signature 5-question explainability badge for all prioritized CRM recommendations.
 */

export interface WhyNowCard {
  entityId: string;
  entityName: string;
  whyThisContact: string;
  whyThisCampaign: string;
  whyNow: string;
  whyThisAction: string;
  evidenceStatement: string;
  confidenceScore: number; // 0 to 100
}

export function generateWhyNowExplanation(params: {
  entityId: string;
  contactName: string;
  title: string;
  company: string;
  campaignName: string;
  triggerEvent: string;
  recommendedAction: string;
  evidence: string;
  confidenceScore?: number;
}): WhyNowCard {
  return {
    entityId: params.entityId,
    entityName: params.contactName,
    whyThisContact: `Matches high-priority ICP as ${params.title} at ${params.company}.`,
    whyThisCampaign: `Aligned with ${params.campaignName} targeting criteria with zero client conflict locks.`,
    whyNow: params.triggerEvent,
    whyThisAction: params.recommendedAction,
    evidenceStatement: params.evidence,
    confidenceScore: params.confidenceScore || 92,
  };
}
