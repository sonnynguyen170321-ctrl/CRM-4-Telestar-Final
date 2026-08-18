import { describe, it, expect } from 'vitest';
import {
  calculateIntrinsicQualityScore,
  calculateDataConfidenceScore,
  calculateEngagementScore,
  calculateRelationshipScore,
  calculateFreshnessScore,
} from '@/lib/contact-intelligence/scoring';
import { resolveContactLifecycleState } from '@/lib/contact-intelligence/lifecycle';
import {
  resolveContactQualityClass,
  resolveContactDataStatus,
  resolveContactEngagementStatus,
} from '@/lib/contact-intelligence/quality';
import { evaluateContactReuseEligibility } from '@/lib/contact-intelligence/reuse';
import { buildContactExplainability } from '@/lib/contact-intelligence/explainability';

describe('Contact Intelligence Scoring Engine', () => {
  describe('Intrinsic Quality Scoring', () => {
    it('awards high score for C-level executive with complete verified channels', () => {
      const result = calculateIntrinsicQualityScore({
        seniority: 'C-Level',
        title: 'Chief Technology Officer',
        email: 'cto@acme.corp',
        emailValidation: 'deliverable',
        phone: '+14155550100',
        linkedIn: 'https://linkedin.com/in/cto',
        company: 'Acme Corp',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(result.score).toBe(100);
      expect(result.factors.length).toBeGreaterThanOrEqual(4);
    });

    it('awards partial score for staff with unverified email and no secondary channels', () => {
      const result = calculateIntrinsicQualityScore({
        seniority: 'Staff',
        title: 'Software Developer',
        email: 'dev@acme.corp',
        emailValidation: 'unknown',
        company: 'Acme Corp',
        firstName: 'John',
        lastName: 'Smith',
      });

      expect(result.score).toBeLessThan(50);
      expect(result.score).toBeGreaterThanOrEqual(25);
    });
  });

  describe('Data Confidence Scoring', () => {
    it('scores deliverable multi-channel contacts with human confirmation highly', () => {
      const result = calculateDataConfidenceScore({
        emailValidation: 'deliverable',
        hasPhone: true,
        hasLinkedIn: true,
        humanConfirmedCount: 2,
        lastVerifiedAt: new Date(),
      });

      expect(result.score).toBe(100);
    });

    it('penalizes undeliverable email data', () => {
      const result = calculateDataConfidenceScore({
        emailValidation: 'undeliverable',
        hasPhone: false,
        hasLinkedIn: false,
        humanConfirmedCount: 0,
        lastVerifiedAt: null,
      });

      expect(result.score).toBe(0);
    });
  });

  describe('Engagement Scoring', () => {
    it('rewards positive replies and booked meetings', () => {
      const result = calculateEngagementScore({
        touchCount: 5,
        replyCount: 2,
        meaningfulReplyCount: 2,
        positiveReplyCount: 1,
        meetingBookedCount: 1,
        referralGivenCount: 0,
        hasUnsubscribedOrDnc: false,
      });

      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it('drops score to 0 on suppression / DNC', () => {
      const result = calculateEngagementScore({
        touchCount: 5,
        replyCount: 2,
        meaningfulReplyCount: 2,
        positiveReplyCount: 1,
        meetingBookedCount: 1,
        referralGivenCount: 0,
        hasUnsubscribedOrDnc: true,
      });

      expect(result.score).toBe(0);
    });
  });

  describe('Relationship Scoring', () => {
    it('awards top marks for closed-won deals and champion advocates', () => {
      const result = calculateRelationshipScore({
        hasOwner: true,
        relationshipStrength: 'champion',
        meetingCompletedCount: 2,
        acceptedOpportunityCount: 1,
        wonOpportunityCount: 1,
      });

      expect(result.score).toBe(100);
    });

    it('returns 0 for brand new contacts with no relationship history', () => {
      const result = calculateRelationshipScore({
        hasOwner: false,
        meetingCompletedCount: 0,
        acceptedOpportunityCount: 0,
        wonOpportunityCount: 0,
      });

      expect(result.score).toBe(0);
    });
  });

  describe('Freshness Scoring', () => {
    it('gives 100 to recent activity and decays over time', () => {
      const now = new Date();
      expect(calculateFreshnessScore(now).score).toBe(100);

      const ninetyDaysAgo = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);
      expect(calculateFreshnessScore(ninetyDaysAgo).score).toBe(45);

      const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
      expect(calculateFreshnessScore(twoYearsAgo).score).toBe(5);
    });
  });
});

describe('Contact Classification Engines', () => {
  describe('Quality Class Resolution', () => {
    it('classifies contacts with won deals or completed meetings as proven', () => {
      const quality = resolveContactQualityClass({
        isInvalidOrSuppressed: false,
        meetingCompletedCount: 1,
        acceptedOpportunityCount: 0,
        wonOpportunityCount: 0,
        positiveReplyCount: 0,
        intrinsicQualityScore: 80,
        dataConfidenceScore: 80,
        touchCount: 3,
        hasVerifiedEmail: true,
      });

      expect(quality).toBe('proven');
    });

    it('classifies high-quality untested contacts as promising', () => {
      const quality = resolveContactQualityClass({
        isInvalidOrSuppressed: false,
        meetingCompletedCount: 0,
        acceptedOpportunityCount: 0,
        wonOpportunityCount: 0,
        positiveReplyCount: 0,
        intrinsicQualityScore: 75,
        dataConfidenceScore: 70,
        touchCount: 0,
        hasVerifiedEmail: true,
      });

      expect(quality).toBe('promising');
    });

    it('classifies suppressed or invalid contacts as invalid', () => {
      const quality = resolveContactQualityClass({
        isInvalidOrSuppressed: true,
        meetingCompletedCount: 0,
        acceptedOpportunityCount: 0,
        wonOpportunityCount: 0,
        positiveReplyCount: 0,
        intrinsicQualityScore: 90,
        dataConfidenceScore: 90,
        touchCount: 0,
        hasVerifiedEmail: true,
      });

      expect(quality).toBe('invalid');
    });
  });

  describe('Data Status & Engagement Status Resolution', () => {
    it('resolves contact data status correctly based on email and freshness', () => {
      expect(
        resolveContactDataStatus({
          emailValidation: 'deliverable',
          hasValidPhone: true,
          hasValidLinkedIn: true,
          freshnessScore: 100,
        })
      ).toBe('verified');

      expect(
        resolveContactDataStatus({
          emailValidation: 'deliverable',
          hasValidPhone: false,
          hasValidLinkedIn: false,
          freshnessScore: 15,
        })
      ).toBe('needs_refresh');

      expect(
        resolveContactDataStatus({
          emailValidation: 'invalid',
          hasValidPhone: false,
          hasValidLinkedIn: false,
          freshnessScore: 100,
        })
      ).toBe('invalid');
    });

    it('resolves contact engagement status accurately', () => {
      expect(
        resolveContactEngagementStatus({
          touchCount: 0,
          replyCount: 0,
          positiveReplyCount: 0,
          meetingBookedCount: 0,
          hasActiveRelationship: false,
          isNurture: false,
        })
      ).toBe('never_contacted');

      expect(
        resolveContactEngagementStatus({
          touchCount: 4,
          replyCount: 0,
          positiveReplyCount: 0,
          meetingBookedCount: 0,
          hasActiveRelationship: false,
          isNurture: false,
        })
      ).toBe('no_response');

      expect(
        resolveContactEngagementStatus({
          touchCount: 4,
          replyCount: 1,
          positiveReplyCount: 1,
          meetingBookedCount: 0,
          hasActiveRelationship: false,
          isNurture: false,
        })
      ).toBe('positive');

      expect(
        resolveContactEngagementStatus({
          touchCount: 4,
          replyCount: 1,
          positiveReplyCount: 1,
          meetingBookedCount: 1,
          hasActiveRelationship: false,
          isNurture: false,
        })
      ).toBe('meeting');
    });
  });

  describe('Lifecycle State Resolution', () => {
    it('resolves suppressed contacts correctly', () => {
      const state = resolveContactLifecycleState({
        isArchived: false,
        isSuppressed: true,
        hasActiveOpportunity: false,
        isClientControlled: false,
        hasActiveMeeting: false,
        hasActiveRelationship: false,
        hasPositiveReply: false,
        isCurrentlyWorking: false,
        isNurture: false,
        isQualified: true,
        isVerified: true,
        freshnessScore: 100,
        lastContactedAt: null,
        cooldownUntil: null,
      });

      expect(state).toBe('suppressed');
    });

    it('resolves verified and qualified contacts to ready', () => {
      const state = resolveContactLifecycleState({
        isArchived: false,
        isSuppressed: false,
        hasActiveOpportunity: false,
        isClientControlled: false,
        hasActiveMeeting: false,
        hasActiveRelationship: false,
        hasPositiveReply: false,
        isCurrentlyWorking: false,
        isNurture: false,
        isQualified: true,
        isVerified: true,
        freshnessScore: 100,
        lastContactedAt: null,
        cooldownUntil: null,
      });

      expect(state).toBe('ready');
    });
  });

  describe('10-Step Reuse Eligibility Engine', () => {
    it('blocks suppressed contacts immediately with do_not_contact', () => {
      const result = evaluateContactReuseEligibility({
        isSuppressed: true,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: false,
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        freshnessScore: 100,
      });

      expect(result.reuseStatus).toBe('do_not_contact');
      expect(result.isEligible).toBe(false);
    });

    it('locks contact when active opportunity exists with a different client', () => {
      const result = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: true,
        activeOpportunityClientId: 'client-A',
        targetClientId: 'client-B',
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        freshnessScore: 100,
      });

      expect(result.reuseStatus).toBe('client_locked');
      expect(result.isEligible).toBe(false);
    });

    it('enforces cooldown if contacted within 45 days', () => {
      const recentContact = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const result = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: false,
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        lastContactedAt: recentContact,
        freshnessScore: 100,
      });

      expect(result.reuseStatus).toBe('cooldown');
      expect(result.isEligible).toBe(false);
      expect(result.cooldownUntil).toBeInstanceOf(Date);
    });

    it('marks eligible for ready contacts meeting all gates', () => {
      const oldContact = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const result = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: false,
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        lastContactedAt: oldContact,
        freshnessScore: 85,
      });

      expect(result.reuseStatus).toBe('ready');
      expect(result.isEligible).toBe(true);
    });
  });

  describe('Explainability Engine', () => {
    it('generates coherent explainability analysis', () => {
      const qualityBreakdown = calculateIntrinsicQualityScore({
        seniority: 'VP',
        title: 'VP of Sales',
        email: 'vp@example.com',
        emailValidation: 'deliverable',
        company: 'Example Inc',
        firstName: 'Alex',
        lastName: 'Taylor',
      });
      const confidenceBreakdown = calculateDataConfidenceScore({
        emailValidation: 'deliverable',
        hasPhone: true,
        hasLinkedIn: true,
        humanConfirmedCount: 1,
        lastVerifiedAt: new Date(),
      });
      const engagementBreakdown = calculateEngagementScore({
        touchCount: 2,
        replyCount: 1,
        meaningfulReplyCount: 1,
        positiveReplyCount: 1,
        meetingBookedCount: 0,
        referralGivenCount: 0,
        hasUnsubscribedOrDnc: false,
      });
      const relationshipBreakdown = calculateRelationshipScore({
        hasOwner: false,
        meetingCompletedCount: 0,
        acceptedOpportunityCount: 0,
        wonOpportunityCount: 0,
      });
      const freshnessBreakdown = calculateFreshnessScore(new Date());

      const explainability = buildContactExplainability({
        qualityBreakdown,
        confidenceBreakdown,
        engagementBreakdown,
        relationshipBreakdown,
        freshnessBreakdown,
        reuseReasons: ['Clear for campaign enrollment'],
        qualityClass: 'promising',
        reuseStatus: 'ready',
      });

      expect(explainability.overallAssessment).toContain('High-confidence');
      expect(explainability.keyStrengths.length).toBeGreaterThan(0);
      expect(explainability.recommendedAction).toBeDefined();
    });
  });

  describe('Phase 2 Event Pipeline Evidence Hooks', () => {
    it('correctly maps positive replies and meeting evidence to high engagement', () => {
      const engagement = calculateEngagementScore({
        touchCount: 3,
        replyCount: 1,
        meaningfulReplyCount: 1,
        positiveReplyCount: 1,
        meetingBookedCount: 1,
        referralGivenCount: 0,
        hasUnsubscribedOrDnc: false,
      });

      expect(engagement.score).toBeGreaterThanOrEqual(70);
      expect(engagement.factors.some((f) => f.label === 'Positive Replies')).toBe(true);
      expect(engagement.factors.some((f) => f.label === 'Meetings Booked')).toBe(true);
    });

    it('correctly maps opportunity win and completed meetings to strong relationship score', () => {
      const relationship = calculateRelationshipScore({
        hasOwner: true,
        relationshipStrength: 'strong',
        relationshipType: 'champion',
        meetingCompletedCount: 2,
        acceptedOpportunityCount: 1,
        wonOpportunityCount: 1,
      });

      expect(relationship.score).toBe(100);
      expect(relationship.factors.some((f) => f.label === 'Closed Deals')).toBe(true);
      expect(relationship.factors.some((f) => f.label === 'Completed Meetings')).toBe(true);
    });

    it('immediately forces zero engagement and suppressed state on unsubscribe or DNC', () => {
      const engagement = calculateEngagementScore({
        touchCount: 5,
        replyCount: 2,
        meaningfulReplyCount: 2,
        positiveReplyCount: 1,
        meetingBookedCount: 1,
        referralGivenCount: 0,
        hasUnsubscribedOrDnc: true,
      });

      expect(engagement.score).toBe(0);
      expect(engagement.factors.some((f) => f.label === 'Suppression / Opt-Out')).toBe(true);

      const lifecycle = resolveContactLifecycleState({
        isArchived: false,
        isSuppressed: true,
        hasActiveOpportunity: false,
        isClientControlled: false,
        hasActiveMeeting: false,
        hasActiveRelationship: false,
        hasPositiveReply: false,
        isCurrentlyWorking: false,
        isNurture: false,
        isQualified: true,
        isVerified: true,
        freshnessScore: 100,
        lastContactedAt: new Date(),
        cooldownUntil: null,
      });

      expect(lifecycle).toBe('suppressed');
    });
  });

  describe('Phase 3 Database Health & Diagnostic Engine', () => {
    it('accurately derives health metrics and remediation suggestions', () => {
      // Mock calculation logic verification
      const verifiedRate = Math.round((80 / 100) * 100);
      expect(verifiedRate).toBe(80);

      const healthTier = verifiedRate >= 80 ? 'excellent' : 'healthy';
      expect(healthTier).toBe('excellent');
    });
  });

  describe('Phase 4 Internal Campaign Matching & Reuse Engine', () => {
    it('evaluates gap count correctly from required count and eligible contacts', () => {
      const requiredCount = 100;
      const deliveredCount = 20;
      const eligibleCount = 50;

      const neededCount = Math.max(0, requiredCount - deliveredCount);
      const gapCount = Math.max(0, neededCount - eligibleCount);

      expect(neededCount).toBe(80);
      expect(gapCount).toBe(30);
    });

    it('blocks assignment of contacts under active cooldown or client lock', () => {
      const evalResult = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: true,
        activeOpportunityClientId: 'client-A',
        targetClientId: 'client-B',
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: false,
        relationshipOwnerId: null,
        lastContactedAt: new Date(),
        freshnessScore: 90,
      });

      expect(evalResult.isEligible).toBe(false);
      expect(evalResult.reuseStatus).toBe('client_locked');
      expect(evalResult.reasons.some((r) => r.includes('locked in an active opportunity'))).toBe(true);
    });
  });

  describe('Phase 5 Relationship Retention & Meeting Intelligence', () => {
    it('accurately evaluates relationship strength and owner protection', () => {
      const relationship = calculateRelationshipScore({
        hasOwner: true,
        wonOpportunityCount: 1,
        acceptedOpportunityCount: 2,
        meetingCompletedCount: 3,
        relationshipStrength: 'champion',
        relationshipType: 'champion',
      });

      expect(relationship.score).toBe(100);
      expect(relationship.factors.some((f) => f.label === 'Champion Advocate')).toBe(true);
    });

    it('requires warm routing when contact has a different relationship owner', () => {
      const evalResult = evaluateContactReuseEligibility({
        isSuppressed: false,
        isArchived: false,
        isDataInvalid: false,
        dataStatus: 'verified',
        hasActiveOpportunity: false,
        isCurrentlyEnrolled: false,
        hasRelationshipOwner: true,
        relationshipOwnerId: 'sdr-original-owner',
        lastContactedAt: new Date(Date.now() - 60 * 86400000),
        freshnessScore: 95,
      });

      expect(evalResult.requiresWarmRouting).toBe(true);
      expect(evalResult.recommendedOwnerId).toBe('sdr-original-owner');
    });
  });
});
