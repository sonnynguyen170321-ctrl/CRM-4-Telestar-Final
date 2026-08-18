import { describe, it, expect } from 'vitest';
import {
  calculateIntrinsicQualityScore,
  calculateDataConfidenceScore,
  calculateRelationshipScore,
  resolveContactQualityClass,
  evaluateContactReuseEligibility,
  extractCommercialSignalsFromText,
  buildContactExplainability,
} from '@/lib/contact-intelligence';

describe('Telestar Commercial Intelligence Master Certification Suite', () => {
  describe('1. Unstructured AI Signal Extraction Engine', () => {
    it('accurately identifies competitor tools mentioned in sales notes', () => {
      const note = 'Prospect mentioned they currently use Salesforce and Outreach, but are evaluating HubSpot for their inbound SDR team.';
      const signals = extractCommercialSignalsFromText(note);

      expect(signals.length).toBeGreaterThanOrEqual(3);
      const vendors = signals.map((s) => s.valueJson?.vendor);
      expect(vendors).toContain('Salesforce');
      expect(vendors).toContain('Outreach');
      expect(vendors).toContain('HubSpot');
    });

    it('accurately extracts timing, budget, and pain point signals', () => {
      const reply = 'We are struggling with manual data entry bottlenecks. Pricing seems expensive right now, let us revisit in Q3 when new budget is approved.';
      const signals = extractCommercialSignalsFromText(reply);

      const types = signals.map((s) => s.evidenceType);
      expect(types).toContain('pain_point');
      expect(types).toContain('budget_signal');
      expect(types).toContain('timing_signal');
    });

    it('extracts referral signals with target stakeholder names', () => {
      const text = 'Please reach out to Marcus Webb who manages our commercial operations.';
      const signals = extractCommercialSignalsFromText(text);

      const referral = signals.find((s) => s.evidenceType === 'referral_given');
      expect(referral).toBeDefined();
      expect(referral?.summary).toContain('colleague/stakeholder');
    });
  });

  describe('2. Multi-Dimensional Scoring Engine & Classifications', () => {
    it('scores an executive decision maker with proven deal history at maximum tier', () => {
      const quality = calculateIntrinsicQualityScore({
        title: 'Chief Technology Officer',
        seniority: 'c-level',
        email: 'cto@enterprise.com',
        emailValidation: 'valid',
        phone: '+15550199',
        linkedIn: 'https://linkedin.com/in/cto',
        company: 'Enterprise Corp',
        firstName: 'Marcus',
        lastName: 'Webb',
      });

      const confidence = calculateDataConfidenceScore({
        emailValidation: 'valid',
        emailScore: 98,
        hasPhone: true,
        hasLinkedIn: true,
        humanConfirmedCount: 2,
        lastVerifiedAt: new Date(),
      });

      const relationship = calculateRelationshipScore({
        hasOwner: true,
        wonOpportunityCount: 1,
        acceptedOpportunityCount: 2,
        meetingCompletedCount: 3,
        relationshipStrength: 'champion',
        relationshipType: 'champion',
      });

      expect(quality.score).toBeGreaterThanOrEqual(90);
      expect(confidence.score).toBeGreaterThanOrEqual(90);
      expect(relationship.score).toBe(100);

      const qualityClass = resolveContactQualityClass({
        intrinsicQualityScore: quality.score,
        dataConfidenceScore: confidence.score,
        wonOpportunityCount: 1,
        acceptedOpportunityCount: 2,
        meetingCompletedCount: 3,
        positiveReplyCount: 0,
        touchCount: 3,
        hasVerifiedEmail: true,
        isInvalidOrSuppressed: false,
      });

      expect(qualityClass).toBe('proven');
    });
  });

  describe('3. Multi-Factor 10-Step Deterministic Reuse & Safety Collision Engine', () => {
    it('strictly locks contact when active opportunity belongs to a different client', () => {
      const result = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: true,
        activeOpportunityClientId: 'client-Alpha',
        targetClientId: 'client-Beta',
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        relationshipOwnerId: null,
        lastContactedAt: new Date(Date.now() - 10 * 86400000),
        freshnessScore: 90,
      });

      expect(result.isEligible).toBe(false);
      expect(result.reuseStatus).toBe('client_locked');
      expect(result.reasons[0]).toContain('locked in an active opportunity');
    });

    it('enforces cooldown if contact was engaged within standard 45-day window', () => {
      const recentContact = new Date(Date.now() - 15 * 86400000); // 15 days ago
      const result = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: false,
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        relationshipOwnerId: null,
        lastContactedAt: recentContact,
        cooldownDays: 45,
        freshnessScore: 90,
      });

      expect(result.isEligible).toBe(false);
      expect(result.reuseStatus).toBe('cooldown');
      expect(result.reasons[0]).toContain('cooldown');
    });

    it('clears contact for immediate reuse when past cooldown and no deal conflicts exist', () => {
      const oldContact = new Date(Date.now() - 60 * 86400000); // 60 days ago
      const result = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: false,
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        relationshipOwnerId: null,
        lastContactedAt: oldContact,
        cooldownDays: 45,
        freshnessScore: 85,
      });

      expect(result.isEligible).toBe(true);
      expect(result.reuseStatus).toBe('ready');
    });
  });

  describe('4. Explainability & Human Diagnostics', () => {
    it('produces structured audit explainability breakdowns for commercial operators', () => {
      const explain = buildContactExplainability({
        qualityBreakdown: { score: 88, factors: [] },
        confidenceBreakdown: { score: 92, factors: [] },
        engagementBreakdown: { score: 75, factors: [] },
        relationshipBreakdown: { score: 80, factors: [] },
        freshnessBreakdown: { score: 90, factors: [] },
        reuseReasons: ['Clear of active deals', 'Past outreach cooldown'],
        qualityClass: 'proven',
        reuseStatus: 'ready',
      });

      expect(explain.overallAssessment).toContain('Proven commercial asset');
      expect(explain.recommendedAction).toContain('Prioritize');
      expect(explain.keyStrengths.length).toBeGreaterThan(0);
      expect(explain.reuseReasons.length).toBe(2);
    });
  });
});
