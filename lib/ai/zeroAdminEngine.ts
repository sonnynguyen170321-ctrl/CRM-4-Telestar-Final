/**
 * Telestar Zero-Administration CRM Engine (Directive Phase 19 §75, §76).
 * Automatically extracts structured CRM mutation proposals from inbound replies and call activities.
 */

export interface CrmUpdateProposal {
  id: string;
  leadId: string;
  leadName: string;
  suggestedStageTransition?: string | null;
  suggestedNotes?: string | null;
  suggestedFollowUpTask?: { title: string; dueDate: Date; priority: 'high' | 'medium' | 'low' } | null;
  detectedObjection?: string | null;
  commercialSignal?: string | null;
  confidence: number;
  requiresUserConfirmation: boolean;
  status: 'PROPOSED' | 'CONFIRMED' | 'DISMISSED';
}

export function parseInteractionToCrmProposal(params: {
  leadId: string;
  leadName: string;
  currentStage: string;
  interactionType: 'INBOUND_REPLY' | 'CALL_SUMMARY' | 'MEETING_COMPLETED';
  rawText: string;
}): CrmUpdateProposal {
  const text = params.rawText.toLowerCase();
  let suggestedStage: string | null = null;
  let detectedObjection: string | null = null;
  let followUpTitle = 'Follow up with prospect';
  let priority: 'high' | 'medium' | 'low' = 'medium';

  if (/interested|send more info|sounds good|let's talk|available on/i.test(text)) {
    suggestedStage = 'replied';
    followUpTitle = 'Respond to positive inbound reply & schedule call';
    priority = 'high';
  } else if (/not interested|remove me|unsubscribe|stop/i.test(text)) {
    suggestedStage = 'lost';
    detectedObjection = 'Prospect requested no further outreach';
    priority = 'low';
  } else if (/timing|busy right now|reach out next quarter|q3|q4/i.test(text)) {
    suggestedStage = 'nurture';
    detectedObjection = 'Timing / Future quarter follow-up';
    followUpTitle = 'Schedule Q3 relationship nurture touchpoint';
    priority = 'medium';
  }

  const dueDate = new Date(Date.now() + (priority === 'high' ? 2 * 3600 * 1000 : 24 * 3600 * 1000));

  return {
    id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    leadId: params.leadId,
    leadName: params.leadName,
    suggestedStageTransition: suggestedStage && suggestedStage !== params.currentStage ? suggestedStage : null,
    suggestedNotes: `Auto-extracted from ${params.interactionType.toLowerCase()}: "${params.rawText.slice(0, 120)}..."`,
    suggestedFollowUpTask: {
      title: followUpTitle,
      dueDate,
      priority,
    },
    detectedObjection,
    commercialSignal: priority === 'high' ? 'High buying intent' : null,
    confidence: 0.94,
    requiresUserConfirmation: true,
    status: 'PROPOSED',
  };
}
