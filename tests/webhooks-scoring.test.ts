import { describe, it, expect } from 'vitest';
import { signWebhookPayload } from '@/lib/webhooks/dispatcher';
import { calculateLeadScore, DEFAULT_SCORING_RULES } from '@/lib/leads/scoring';

describe('Custom Webhook Signature Engine', () => {
  it('computes deterministic HMAC-SHA256 signatures', () => {
    const payload = JSON.stringify({ event: 'lead.created', id: '123' });
    const secret = 'whsec_sample_secret_key_12345';
    const sig1 = signWebhookPayload(payload, secret);
    const sig2 = signWebhookPayload(payload, secret);
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // 32 bytes hex
  });

  it('produces different signatures for different secrets or payloads', () => {
    const payload = JSON.stringify({ event: 'lead.created' });
    const sig1 = signWebhookPayload(payload, 'secret_1');
    const sig2 = signWebhookPayload(payload, 'secret_2');
    expect(sig1).not.toBe(sig2);
  });
});

describe('Lead Scoring Engine', () => {
  it('scores executive leads with opens and replies into Hot priority', () => {
    const result = calculateLeadScore(
      {
        title: 'Chief Technology Officer',
        emailSentCount: 2,
        emailOpenCount: 3,
        emailReplyCount: 1,
        emailValidation: 'valid',
        phone: '+1 415 555 0199',
        meetingCount: 0,
      },
      DEFAULT_SCORING_RULES
    );

    // C-Level (25) + 3 opens (15) + Reply (30) + Valid email (10) + Phone (10) = 90
    expect(result.score).toBe(90);
    expect(result.priority).toBe('hot');
    expect(result.breakdown.length).toBeGreaterThan(3);
  });

  it('applies penalty for bounced emails', () => {
    const result = calculateLeadScore(
      {
        title: 'Staff Engineer',
        emailOpenCount: 0,
        emailReplyCount: 0,
        emailInvalid: true,
        emailValidation: 'invalid',
      },
      DEFAULT_SCORING_RULES
    );

    expect(result.score).toBe(0); // Clamped at 0
    expect(result.priority).toBe('cold');
  });

  it('prioritizes meetings as hot leads', () => {
    const result = calculateLeadScore(
      {
        title: 'VP of Marketing',
        meetingCount: 1,
        phone: '+84 901 234 567',
      },
      DEFAULT_SCORING_RULES
    );

    // VP (15) + Meeting (40) + Valid default email (10) + Phone (10) = 75 >= 65 (hot)
    expect(result.score).toBe(75);
    expect(result.priority).toBe('hot');
  });
});
