import { describe, it, expect } from 'vitest';
import { calculateWarmupStatus, STANDARD_WARMUP_SCHEDULE } from '@/lib/email-health/warmup';
import { categorizeBounceError } from '@/lib/email-health/errorCategorizer';
import { calculateSafetyCapAdjustment } from '@/lib/email-health/capAdjustment';
import { evaluateDeliverabilityCompliance } from '@/lib/email-health/thresholds';
import { isPlausibleDomain } from '@/lib/email-health/domains';

describe('Phase 8 Deliverability & Email Health', () => {
  describe('Warmup Engine (lib/email-health/warmup.ts)', () => {
    it('correctly stages a new account under 3 days old', () => {
      const result = calculateWarmupStatus({
        accountCreatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        totalSentLifetime: 25,
        sentLast3Days: [12, 10, 3],
        recentBounceRate: 0.0,
      });

      expect(result.stage).toBe('new');
      expect(result.recommendedDailyCap).toBe(15);
      expect(result.isVolumeSpikeDetected).toBe(false);
      expect(result.schedule).toEqual(STANDARD_WARMUP_SCHEDULE);
    });

    it('identifies mature account and respects configured cap', () => {
      const result = calculateWarmupStatus({
        accountCreatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        totalSentLifetime: 3500,
        sentLast3Days: [80, 85, 78],
        recentBounceRate: 0.01,
        currentConfiguredCap: 120,
      });

      expect(result.stage).toBe('mature');
      expect(result.recommendedDailyCap).toBe(120);
      expect(result.isVolumeSpikeDetected).toBe(false);
    });

    it('throttles recommended daily cap when bounce rate exceeds 5%', () => {
      const result = calculateWarmupStatus({
        accountCreatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        totalSentLifetime: 200,
        sentLast3Days: [30, 25, 20],
        recentBounceRate: 0.07,
      });

      expect(result.stage).toBe('ramping_mid');
      // Standard ramping_mid is 60, throttled by 50% gives 30
      expect(result.recommendedDailyCap).toBe(30);
      expect(result.recommendations.some((r) => r.includes('throttled by 50%'))).toBe(true);
    });

    it('flags sudden volume spike when sending jumps > 2.5x over previous average', () => {
      const result = calculateWarmupStatus({
        accountCreatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        totalSentLifetime: 100,
        sentLast3Days: [90, 15, 10], // Jump to 90 from avg ~12.5
        recentBounceRate: 0.01,
      });

      expect(result.isVolumeSpikeDetected).toBe(true);
      expect(result.recommendations.some((r) => r.includes('Sudden sending spike detected'))).toBe(true);
    });
  });

  describe('SMTP Error & Bounce Categorizer (lib/email-health/errorCategorizer.ts)', () => {
    it('categorizes 5.1.1 user unknown as hard bounce', () => {
      const res = categorizeBounceError('550 5.1.1 <test@example.com>: Recipient address rejected: User unknown in virtual mailbox table');
      expect(res.category).toBe('mailbox_not_found');
      expect(res.isHardBounce).toBe(true);
      expect(res.shouldPauseAccount).toBe(false);
      expect(res.severity).toBe('medium');
    });

    it('categorizes spamhaus / blacklist response as critical and triggers auto-pause recommendation', () => {
      const res = categorizeBounceError('554 5.7.1 Service unavailable; Client host [1.2.3.4] blocked using Spamhaus ZEN');
      expect(res.category).toBe('spam_block');
      expect(res.isHardBounce).toBe(false);
      expect(res.shouldPauseAccount).toBe(true);
      expect(res.severity).toBe('critical');
    });

    it('categorizes 421 rate limit as high severity rate limit exceeded', () => {
      const res = categorizeBounceError('421 4.7.0 Rate limit exceeded. Try again later.');
      expect(res.category).toBe('rate_limit_exceeded');
      expect(res.isHardBounce).toBe(false);
      expect(res.severity).toBe('high');
    });

    it('categorizes DMARC / SPF policy rejections', () => {
      const res = categorizeBounceError('550 5.7.26 Unauthenticated email from domain is not accepted due to DMARC policy');
      expect(res.category).toBe('dmarc_spf_failure');
      expect(res.shouldPauseAccount).toBe(true);
      expect(res.severity).toBe('high');
    });

    it('categorizes soft bounce mailbox full without hard bounce flag', () => {
      const res = categorizeBounceError('452 4.2.2 Mailbox full, quota exceeded');
      expect(res.category).toBe('mailbox_full');
      expect(res.isHardBounce).toBe(false);
      expect(res.severity).toBe('low');
    });
  });

  describe('Safety Cap Adjustment (lib/email-health/capAdjustment.ts)', () => {
    it('recommends pausing and 100% reduction for critical health band', () => {
      const res = calculateSafetyCapAdjustment({
        currentDailyCap: 100,
        healthBand: 'critical',
        bounceRate7d: 0.09,
      });

      expect(res.recommendedCap).toBe(0);
      expect(res.reductionPercentage).toBe(100);
      expect(res.shouldAutoPause).toBe(true);
      expect(res.isAdjusted).toBe(true);
    });

    it('recommends 70% reduction for poor health band or bounce rate > 5%', () => {
      const res = calculateSafetyCapAdjustment({
        currentDailyCap: 100,
        healthBand: 'poor',
        bounceRate7d: 0.06,
      });

      expect(res.recommendedCap).toBe(30);
      expect(res.reductionPercentage).toBe(70);
      expect(res.shouldAutoPause).toBe(false);
      expect(res.isAdjusted).toBe(true);
    });

    it('recommends 40% reduction for fair health band', () => {
      const res = calculateSafetyCapAdjustment({
        currentDailyCap: 100,
        healthBand: 'fair',
        bounceRate7d: 0.03,
      });

      expect(res.recommendedCap).toBe(60);
      expect(res.reductionPercentage).toBe(40);
      expect(res.isAdjusted).toBe(true);
    });

    it('maintains 100% cap for good health', () => {
      const res = calculateSafetyCapAdjustment({
        currentDailyCap: 80,
        healthBand: 'good',
        bounceRate7d: 0.01,
      });

      expect(res.recommendedCap).toBe(80);
      expect(res.reductionPercentage).toBe(0);
      expect(res.isAdjusted).toBe(false);
    });
  });

  describe('Deliverability Thresholds (lib/email-health/thresholds.ts)', () => {
    it('evaluates compliant metrics', () => {
      const res = evaluateDeliverabilityCompliance({
        bounceRate: 0.01,
        spamRate: 0.0001,
        replyRate: 0.04,
        healthScore: 88,
      });

      expect(res.status).toBe('compliant');
      expect(res.violations).toHaveLength(0);
      expect(res.warnings).toHaveLength(0);
    });

    it('detects warning zone for moderate bounce and low reply rate', () => {
      const res = evaluateDeliverabilityCompliance({
        bounceRate: 0.03, // > 2% warning
        spamRate: 0.0001,
        replyRate: 0.005, // < 1% target
        healthScore: 78,
      });

      expect(res.status).toBe('warning');
      expect(res.warnings.length).toBeGreaterThanOrEqual(1);
      expect(res.violations).toHaveLength(0);
    });

    it('detects breached status when bounce rate or spam rate exceeds critical threshold', () => {
      const res = evaluateDeliverabilityCompliance({
        bounceRate: 0.065, // > 5% critical
        spamRate: 0.002,  // > 0.1% critical
        replyRate: 0.02,
        healthScore: 45,
      });

      expect(res.status).toBe('breached');
      expect(res.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Domain Validity (lib/email-health/domains.ts)', () => {
    it('validates proper domain formats', () => {
      expect(isPlausibleDomain('example.com')).toBe(true);
      expect(isPlausibleDomain('mail.salesflow.io')).toBe(true);
      expect(isPlausibleDomain('outreach-domain.co.uk')).toBe(true);
      expect(isPlausibleDomain('invalid domain with space')).toBe(false);
      expect(isPlausibleDomain('')).toBe(false);
    });
  });
});
