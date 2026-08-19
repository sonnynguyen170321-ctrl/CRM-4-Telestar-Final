import { describe, it, expect, beforeEach } from 'vitest';
import { commercialMemory } from '@/lib/ai/commercialMemory';

describe('Phase 3: Commercial Memory & Claim Provenance', () => {
  beforeEach(() => {
    commercialMemory.clear();
  });

  it('records claims with complete provenance metadata', () => {
    const claim = commercialMemory.recordClaim({
      tier: 'CONTACT',
      entityId: 'contact-sarah-1',
      claim: 'Expressed strong interest in AI-assisted CRM workflows during Q2 demo call.',
      sourceType: 'MEETING_NOTES',
      sourceId: 'meeting-7788',
      observedAt: new Date(),
      confidence: 0.95,
      lastConfirmedAt: new Date(),
    });

    expect(claim.id).toBeDefined();
    expect(claim.tier).toBe('CONTACT');
    expect(claim.confidence).toBe(0.95);
    expect(claim.sourceType).toBe('MEETING_NOTES');
  });

  it('handles claim correction and superseding with audit reasons', () => {
    const original = commercialMemory.recordClaim({
      tier: 'CONTACT',
      entityId: 'contact-sarah-1',
      claim: 'Budget estimated at $10k.',
      sourceType: 'AI_INFERENCE',
      sourceId: 'infer-1',
      observedAt: new Date(),
      confidence: 0.6,
      lastConfirmedAt: new Date(),
    });

    const updated = commercialMemory.correctClaim(
      original.id,
      {
        tier: 'CONTACT',
        entityId: 'contact-sarah-1',
        claim: 'Budget confirmed at $50k annually with VP Finance sign-off.',
        sourceType: 'EMAIL_INBOUND',
        sourceId: 'email-9988',
        observedAt: new Date(),
        confidence: 0.99,
        lastConfirmedAt: new Date(),
      },
      'Confirmed by direct inbound prospect email'
    );

    expect(updated.supersedesId).toBe(original.id);
    expect(updated.confidence).toBe(0.99);

    const activeClaims = commercialMemory.getActiveClaimsForEntity('contact-sarah-1');
    expect(activeClaims.length).toBe(1);
    expect(activeClaims[0].claim).toContain('$50k');
  });
});
