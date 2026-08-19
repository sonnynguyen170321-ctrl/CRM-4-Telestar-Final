/**
 * Telestar Proactive Signals & Attention Scoring Engine (Directive Phase 15 §65, §66).
 * Priority dispatcher calculating Impact × Urgency × Confidence × Role Relevance.
 */

export type SignalType =
  | 'HOT_REPLY'
  | 'REPLY_SLA_BREACH'
  | 'UPCOMING_MEETING'
  | 'OPPORTUNITY_STALL'
  | 'LEAD_SHORTAGE'
  | 'CAMPAIGN_DELIVERY_RISK'
  | 'MAILBOX_HEALTH_DEGRADATION';

export interface AttentionSignal {
  id: string;
  type: SignalType;
  title: string;
  description: string;
  impactScore: number; // 1 to 10
  urgencyScore: number; // 1 to 10
  confidenceScore: number; // 0.0 to 1.0
  roleRelevanceScore: number; // 1 to 10
  priorityScore: number; // calculated attention score
  entityType?: 'lead' | 'campaign' | 'meeting' | 'mailbox' | 'opportunity';
  entityId?: string;
  recommendedAction: string;
  createdAt: Date;
}

export function computeAttentionScore(params: {
  impact: number;
  urgency: number;
  confidence: number;
  roleRelevance: number;
}): number {
  // Score = Impact (1-10) * Urgency (1-10) * Confidence (0.1-1.0) * RoleRelevance (1-10)
  const raw = params.impact * params.urgency * params.confidence * params.roleRelevance;
  // Normalized to 0-100 scale
  return Math.min(100, Math.round((raw / 1000) * 100));
}

export function createAttentionSignal(params: {
  type: SignalType;
  title: string;
  description: string;
  impact: number;
  urgency: number;
  confidence: number;
  roleRelevance: number;
  entityType?: AttentionSignal['entityType'];
  entityId?: string;
  recommendedAction: string;
}): AttentionSignal {
  const priorityScore = computeAttentionScore({
    impact: params.impact,
    urgency: params.urgency,
    confidence: params.confidence,
    roleRelevance: params.roleRelevance,
  });

  return {
    id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: params.type,
    title: params.title,
    description: params.description,
    impactScore: params.impact,
    urgencyScore: params.urgency,
    confidenceScore: params.confidence,
    roleRelevanceScore: params.roleRelevance,
    priorityScore,
    entityType: params.entityType,
    entityId: params.entityId,
    recommendedAction: params.recommendedAction,
    createdAt: new Date(),
  };
}
