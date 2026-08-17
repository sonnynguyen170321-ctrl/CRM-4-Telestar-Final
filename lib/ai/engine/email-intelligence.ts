import { LeadStage } from '@prisma/client';

export type ReplyIntent =
  | 'MEETING_REQUEST'
  | 'PRICING_INQUIRY'
  | 'PRODUCT_QUESTION'
  | 'NOT_INTERESTED'
  | 'REFERRAL'
  | 'UNSUBSCRIBE_REQUEST'
  | 'OUT_OF_OFFICE'
  | 'WRONG_PERSON';

export interface EmailClassificationResult {
  intent: ReplyIntent;
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
  keyPhrases: string[];
  suggestedStageTransition?: LeadStage;
  requiresSuppression: boolean;
  draftingGuidance: string;
}

/**
 * 🎯 EMAIL INTELLIGENCE & REPLY CLASSIFIER (Sections 49 & 50)
 * Evaluates inbound email reply intent and suggests safe stage transitions and drafting guidance.
 */
export function classifyInboundReply(emailBody: string): EmailClassificationResult {
  const text = emailBody.toLowerCase().trim();

  // 1. Unsubscribe / Opt-out
  if (
    text.includes('unsubscribe') ||
    text.includes('remove me') ||
    text.includes('stop emailing') ||
    text.includes('do not contact') ||
    text.includes('take me off your list')
  ) {
    return {
      intent: 'UNSUBSCRIBE_REQUEST',
      sentiment: 'negative',
      confidence: 0.99,
      keyPhrases: ['unsubscribe / remove request'],
      suggestedStageTransition: 'lost',
      requiresSuppression: true,
      draftingGuidance: 'Do NOT send a sales follow-up. Acknowledge opt-out gracefully or stay silent.',
    };
  }

  // 2. Out of Office
  if (
    text.includes('out of office') ||
    text.includes('on leave') ||
    text.includes('automatic reply') ||
    text.includes('returning on')
  ) {
    return {
      intent: 'OUT_OF_OFFICE',
      sentiment: 'neutral',
      confidence: 0.95,
      keyPhrases: ['automated out of office message'],
      requiresSuppression: false,
      draftingGuidance: 'Pause sequence until returned date. Do not count as active reply.',
    };
  }

  // 3. Meeting Request / Calendar Confirmation
  if (
    text.includes('calendar') ||
    text.includes('schedule') ||
    text.includes('let us meet') ||
    text.includes("let's talk") ||
    text.includes('free next week') ||
    text.includes('send an invite') ||
    text.includes('book a time')
  ) {
    return {
      intent: 'MEETING_REQUEST',
      sentiment: 'positive',
      confidence: 0.95,
      keyPhrases: ['requested meeting or call'],
      suggestedStageTransition: 'meeting_booked',
      requiresSuppression: false,
      draftingGuidance: 'Provide booking link immediately with 2 concrete time slot options.',
    };
  }

  // 4. Referral / Wrong Person
  if (
    text.includes('reach out to') ||
    text.includes('not the right person') ||
    text.includes('talk to my colleague') ||
    text.includes('ccing')
  ) {
    return {
      intent: 'REFERRAL',
      sentiment: 'neutral',
      confidence: 0.9,
      keyPhrases: ['referred to alternative colleague'],
      requiresSuppression: false,
      draftingGuidance: 'Thank them for the referral and introduce yourself to the recommended contact.',
    };
  }

  // 5. Pricing / Commercial Inquiry
  if (text.includes('cost') || text.includes('pricing') || text.includes('how much') || text.includes('quote')) {
    return {
      intent: 'PRICING_INQUIRY',
      sentiment: 'positive',
      confidence: 0.92,
      keyPhrases: ['pricing and commercial inquiry'],
      suggestedStageTransition: 'replied',
      requiresSuppression: false,
      draftingGuidance: 'Share value tiers and offer a quick 10-minute discovery call to scope exact requirements.',
    };
  }

  // 6. Generic Not Interested
  if (text.includes('not interested') || text.includes('no thank') || text.includes('not at this time')) {
    return {
      intent: 'NOT_INTERESTED',
      sentiment: 'negative',
      confidence: 0.9,
      keyPhrases: ['polite decline'],
      suggestedStageTransition: 'lost',
      requiresSuppression: false,
      draftingGuidance: 'Acknowledge graciously and schedule a gentle check-in for next quarter.',
    };
  }

  // Default: Product / Information Question
  return {
    intent: 'PRODUCT_QUESTION',
    sentiment: 'neutral',
    confidence: 0.85,
    keyPhrases: ['general inquiry'],
    suggestedStageTransition: 'replied',
    requiresSuppression: false,
    draftingGuidance: 'Answer question directly and propose a brief walkthrough demo.',
  };
}
