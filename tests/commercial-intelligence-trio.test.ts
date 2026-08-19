import { describe, it, expect } from 'vitest';
import { evaluateLeadMatch } from '@/lib/ai/leadSupplyEngine';
import { evaluateMeetingQuality } from '@/lib/ai/meetingQualityEngine';
import { evaluatePatternEvidence } from '@/lib/ai/winningPatternEngine';

describe('Phase 8: Lead Supply Matching Engine', () => {
  it('calculates explainable multi-vector matching score with explicit factor reasons', () => {
    const match = evaluateLeadMatch(
      {
        id: 'lead-candidate-1',
        fullName: 'Sarah Connor',
        title: 'VP of Finance',
        seniority: 'Executive',
        industry: 'FinTech',
        country: 'United States',
        emailDeliverable: true,
        hasPhone: true,
        hasLinkedIn: true,
        priorPositiveEngagement: true,
        isClientLocked: false,
        isSuppressed: false,
      },
      {
        targetPersona: 'Finance Director VP Finance',
        targetIndustries: ['FinTech', 'Financial Services'],
        targetSeniority: ['VP', 'Executive', 'Director'],
        targetGeographies: ['United States', 'Canada'],
      }
    );

    expect(match.qualified).toBe(true);
    expect(match.score).toBeGreaterThanOrEqual(85);
    expect(match.matchSummary).toContain('/100');
    expect(match.factors.length).toBe(4);
  });

  it('rejects candidate if suppressed or locked', () => {
    const match = evaluateLeadMatch(
      {
        id: 'lead-candidate-locked',
        fullName: 'John Doe',
        title: 'VP of Finance',
        seniority: 'Executive',
        industry: 'FinTech',
        country: 'United States',
        emailDeliverable: true,
        hasPhone: true,
        hasLinkedIn: true,
        priorPositiveEngagement: false,
        isClientLocked: true, // locked!
        isSuppressed: false,
      },
      {
        targetPersona: 'Finance Director',
        targetIndustries: ['FinTech'],
        targetSeniority: ['Executive'],
        targetGeographies: ['United States'],
      }
    );

    expect(match.qualified).toBe(false);
    expect(match.score).toBe(0);
    expect(match.matchSummary).toContain('Rejected');
  });
});

describe('Phase 9: Meeting Quality Engine', () => {
  it('evaluates post-meeting quality and client acceptance feedback', () => {
    const quality = evaluateMeetingQuality({
      attended: true,
      feedbackGrade: 'EXCELLENT',
      personaFit: true,
      companyFit: true,
      painPointsCount: 3,
      opportunityCreated: true,
    });

    expect(quality.qualityScore).toBe(100);
    expect(quality.qualityClass).toBe('HIGH');
    expect(quality.summary).toContain('EXCELLENT');
  });

  it('scores no-show and rejected meetings appropriately', () => {
    const noShow = evaluateMeetingQuality({
      attended: false,
      personaFit: false,
      companyFit: false,
      painPointsCount: 0,
      opportunityCreated: false,
    });
    expect(noShow.qualityScore).toBe(0);
    expect(noShow.qualityClass).toBe('REJECTED');

    const wrongPersona = evaluateMeetingQuality({
      attended: true,
      feedbackGrade: 'WRONG_PERSONA',
      personaFit: false,
      companyFit: true,
      painPointsCount: 0,
      opportunityCreated: false,
    });
    expect(wrongPersona.qualityScore).toBe(15);
    expect(wrongPersona.qualityClass).toBe('REJECTED');
  });
});

describe('Phase 10: Winning Pattern Engine', () => {
  it('calibrates pattern evidence statements with sample size weighting', () => {
    const pattern = evaluatePatternEvidence({
      dimension: 'TIMING',
      key: 'Tuesday 09:00 AM First Touch',
      sampleSize: 243,
      positiveCount: 22, // ~9.1%
      baselineRate: 0.05, // 5.0%
    });

    expect(pattern.confidence).toBe('HIGH');
    expect(pattern.deltaPercent).toBeGreaterThan(80);
    expect(pattern.evidenceStatement).toContain('In 243 comparable touches');
  });
});
