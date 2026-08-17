import { describe, it, expect } from 'vitest';
import { classifyInboundReply } from '@/lib/ai/engine/email-intelligence';

describe('Telestar AI Phase 1 — High-Value Role Intelligence', () => {
  describe('Inbound Reply Intent & Safety Classification', () => {
    it('detects unsubscribe request and enforces suppression with zero sales follow-up', () => {
      const result = classifyInboundReply('Please unsubscribe me and remove me from your list.');
      expect(result.intent).toBe('UNSUBSCRIBE_REQUEST');
      expect(result.requiresSuppression).toBe(true);
      expect(result.suggestedStageTransition).toBe('lost');
      expect(result.draftingGuidance).toContain('Do NOT send a sales follow-up');
    });

    it('classifies meeting requests and suggests meeting_booked transition', () => {
      const result = classifyInboundReply('Sounds great! Can you send a calendar invite for Tuesday?');
      expect(result.intent).toBe('MEETING_REQUEST');
      expect(result.sentiment).toBe('positive');
      expect(result.suggestedStageTransition).toBe('meeting_booked');
    });

    it('classifies pricing inquiries and suggests replied stage transition', () => {
      const result = classifyInboundReply('How much does the annual enterprise tier cost?');
      expect(result.intent).toBe('PRICING_INQUIRY');
      expect(result.sentiment).toBe('positive');
      expect(result.suggestedStageTransition).toBe('replied');
    });

    it('identifies out of office replies without advancing sales stages', () => {
      const result = classifyInboundReply('I am out of office until next Monday.');
      expect(result.intent).toBe('OUT_OF_OFFICE');
      expect(result.requiresSuppression).toBe(false);
      expect(result.suggestedStageTransition).toBeUndefined();
    });
  });
});
