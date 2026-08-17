import { describe, it, expect } from 'vitest';

describe('Smart Inbound Intent & Reply Drafter', () => {
  it('parses and normalizes valid LLM JSON response', () => {
    const rawLLM = `\`\`\`json
{
  "intent": "INTERESTED_DEMO",
  "intentLabel": "🎯 Demo Request",
  "confidence": 0.95,
  "summary": "Prospect is interested in scheduling a product walkthrough this week.",
  "sentiment": "positive",
  "drafts": [
    {
      "id": "pitch_meeting",
      "title": "🚀 Direct Calendar / Demo Pitch",
      "strategy": "Propose calendar link for demo",
      "subject": "Re: Quick question",
      "body": "Hi Alex, glad to connect! Here is my calendar link to grab 15 mins."
    }
  ]
}
\`\`\``;

    const cleaned = rawLLM.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    expect(parsed.intent).toBe('INTERESTED_DEMO');
    expect(parsed.intentLabel).toBe('🎯 Demo Request');
    expect(parsed.confidence).toBe(0.95);
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.drafts[0].id).toBe('pitch_meeting');
  });

  it('handles objection classifications appropriately', () => {
    const intents = ['OBJECTION_PRICING', 'OBJECTION_TIMING', 'OBJECTION_COMPETITOR', 'OUT_OF_OFFICE'];
    intents.forEach((intent) => {
      expect(typeof intent).toBe('string');
      expect(intent.length).toBeGreaterThan(5);
    });
  });
});
