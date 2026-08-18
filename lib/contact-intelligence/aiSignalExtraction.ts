import type { ContactEvidenceType } from '@prisma/client';
import { emitContactEvidence } from './evidence';
import { recalculateContactIntelligence } from './service';

export interface ExtractedCommercialSignal {
  evidenceType: ContactEvidenceType;
  key: string;
  summary: string;
  confidence: number;
  valueJson?: Record<string, unknown>;
}

/**
 * Deterministic fast pattern-matcher for high-frequency sales signals in notes and replies.
 */
export function extractCommercialSignalsFromText(text: string): ExtractedCommercialSignal[] {
  if (!text || text.trim().length === 0) return [];
  const signals: ExtractedCommercialSignal[] = [];
  const lower = text.toLowerCase();

  // 1. Competitor & Vendor Mentions
  const vendors = [
    { name: 'Salesforce', regex: /\b(salesforce|sfdc)\b/i },
    { name: 'HubSpot', regex: /\bhubspot\b/i },
    { name: 'Apollo', regex: /\bapollo(\.io)?\b/i },
    { name: 'ZoomInfo', regex: /\bzoominfo\b/i },
    { name: 'Outreach', regex: /\boutreach(\.io)?\b/i },
    { name: 'Salesloft', regex: /\bsalesloft\b/i },
    { name: 'Clay', regex: /\bclay(\.com|\.run)?\b/i },
    { name: 'Lusha', regex: /\blusha\b/i },
    { name: 'Gong', regex: /\bgong(\.io)?\b/i },
  ];

  for (const v of vendors) {
    if (v.regex.test(text)) {
      signals.push({
        evidenceType: 'competitor_mentioned',
        key: `vendor_${v.name.toLowerCase()}`,
        summary: `Mentioned incumbent/competitor tool: ${v.name}`,
        confidence: 90,
        valueJson: { vendor: v.name },
      });
    }
  }

  // 2. Timing Signals
  if (/\b(next quarter|q1|q2|q3|q4|next year|in \d+ months|revisit in|reach back in|circle back)\b/i.test(text)) {
    signals.push({
      evidenceType: 'timing_signal',
      key: 'timing_revisit_indicated',
      summary: 'Indicated timeline for future evaluation or revisit',
      confidence: 85,
      valueJson: { snippet: text.substring(0, 120) },
    });
  }

  // 3. Budget & Price Signals
  if (/\b(budget|pricing|expensive|cost|rate card|discount|affordable|roi)\b/i.test(lower)) {
    signals.push({
      evidenceType: 'budget_signal',
      key: 'budget_discussion_noted',
      summary: 'Discussed budget constraints or commercial pricing parameters',
      confidence: 80,
      valueJson: { snippet: text.substring(0, 120) },
    });
  }

  // 4. Pain Points & Objections
  if (/\b(struggling with|bottleneck|manual process|wasting time|too slow|pain point|issue with|frustrated)\b/i.test(lower)) {
    signals.push({
      evidenceType: 'pain_point',
      key: 'pain_point_identified',
      summary: 'Identified core operational friction or pain point',
      confidence: 85,
      valueJson: { snippet: text.substring(0, 120) },
    });
  }

  // 5. Referrals & Authority
  if (/\b(speak with|talk to|loop in|referred to|introduce you to|reach out to)\s+([A-Z][a-z]+(\s+[A-Z][a-z]+)?)/.test(text)) {
    signals.push({
      evidenceType: 'referral_given',
      key: 'referral_stakeholder_introduced',
      summary: 'Provided referral or introduced colleague/stakeholder',
      confidence: 90,
      valueJson: { snippet: text.substring(0, 120) },
    });
  }

  return signals;
}

/**
 * Extracts and persists commercial signals from sales notes, meeting transcripts, or inbound emails.
 */
export async function processTextForCommercialSignals(params: {
  contactId: string;
  text: string;
  sourceType: 'note' | 'reply' | 'meeting';
  sourceId: string;
  userId?: string | null;
  tenantId: string;
  campaignId?: string | null;
  leadId?: string | null;
}): Promise<ExtractedCommercialSignal[]> {
  const { contactId, text, sourceType, sourceId, userId, tenantId, campaignId, leadId } = params;

  const signals = extractCommercialSignalsFromText(text);
  if (signals.length === 0) return [];

  for (const signal of signals) {
    await emitContactEvidence({
      tenantId,
      contactId,
      evidenceType: signal.evidenceType,
      key: signal.key,
      summary: signal.summary,
      sourceType: 'ai_extraction',
      sourceId,
      sourceModel: sourceType === 'meeting' ? 'Meeting' : sourceType === 'reply' ? 'InboundMessage' : 'Note',
      campaignId: campaignId || undefined,
      leadId: leadId || undefined,
      capturedById: userId || undefined,
      confidence: signal.confidence,
      aiGenerated: true,
      valueJson: signal.valueJson,
    });
  }

  await recalculateContactIntelligence(contactId, tenantId);
  return signals;
}
