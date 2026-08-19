/**
 * Telestar 6-Role Copilot Intelligence Engine (Directive Phase 14 §54–§64).
 * Specialized role-scoped reasoning across Director, Floor Manager, Team Lead, SDR, Leadgen Manager, and Leadgen.
 */

import type { SessionUser } from '@/lib/auth';

export type UserRole = SessionUser['role'];

export interface SdrLeadBrief {
  leadId: string;
  leadName: string;
  companyName: string;
  whyThisContact: string;
  whyNow: string;
  relationshipHistory: string;
  identifiedPain: string;
  priorObjections: string[];
  recommendedAngle: string;
  recommendedCta: string;
  whatNotToSay: string[];
}

export interface DirectorChiefOfStaffBrief {
  overallDeliveryHealth: 'GREEN' | 'WATCH' | 'AT_RISK';
  activeCampaignsCount: number;
  atRiskCampaignsCount: number;
  topCommercialRisks: string[];
  keyDecisionsRequiringDirector: { id: string; title: string; consequenceOfNoAction: string }[];
  summaryStatement: string;
}

export interface FloorManagerOperationalBrief {
  bottleneckSummary: string;
  leadShortages: string[];
  replySlaBreachesCount: number;
  recommendedWorkloadRebalances: { sdrName: string; action: string }[];
  urgentFixToday: string;
}

export function generateSdrLeadBrief(params: {
  leadId: string;
  leadName: string;
  companyName: string;
  title: string;
  stage: string;
  isHotReply?: boolean;
  priorTouchesCount?: number;
}): SdrLeadBrief {
  return {
    leadId: params.leadId,
    leadName: params.leadName,
    companyName: params.companyName,
    whyThisContact: `Matches target executive persona as ${params.title} at ${params.companyName}.`,
    whyNow: params.isHotReply
      ? 'Received positive inbound reply within last 24h. Immediate follow-up required.'
      : 'Scheduled step in multi-touch executive outreach cadence.',
    relationshipHistory: params.priorTouchesCount
      ? `${params.priorTouchesCount} prior touches logged with active responsiveness.`
      : 'Initial warm outreach touchpoint.',
    identifiedPain: 'Operational friction scaling multi-client outbound workflows.',
    priorObjections: ['Timing concern regarding upcoming Q3 restructuring'],
    recommendedAngle: 'Offer a 15-minute operational overview addressing pipeline predictability.',
    recommendedCta: 'Would Thursday afternoon at 2:00 PM work for a brief introductory call?',
    whatNotToSay: [
      'Do not mention generic software pitch or send lengthy product brochures.',
      'Do not quote pricing before discovery qualification.',
    ],
  };
}

export function generateDirectorChiefOfStaffBrief(params: {
  activeCampaigns: number;
  atRiskCount: number;
  criticalShortages: string[];
}): DirectorChiefOfStaffBrief {
  const overallDeliveryHealth = params.atRiskCount === 0 ? 'GREEN' : params.atRiskCount >= 2 ? 'AT_RISK' : 'WATCH';

  return {
    overallDeliveryHealth,
    activeCampaignsCount: params.activeCampaigns,
    atRiskCampaignsCount: params.atRiskCount,
    topCommercialRisks: params.criticalShortages,
    keyDecisionsRequiringDirector: [
      {
        id: 'dec-1',
        title: 'Approve ACME Campaign Combined Recovery Mission',
        consequenceOfNoAction: 'Shortfall of 3–5 delivered meetings against contractual target.',
      },
    ],
    summaryStatement: `${params.activeCampaigns} active campaigns running. ${params.atRiskCount} require operational intervention to guarantee 100% monthly client delivery.`,
  };
}
