import { describe, it, expect } from 'vitest';
import { proposeAiExperiment, evaluateExperimentOutcome } from '@/lib/ai/experimentLab';
import { evolvePlaybookVersion } from '@/lib/ai/playbookEvolution';
import { generateCampaignAutopsy, generateCampaignColdStartPlan } from '@/lib/ai/campaignAutopsy';

describe('Phase 11: Revenue Experiment Lab', () => {
  it('proposes controlled A/B experiments and evaluates statistical outcomes down-funnel', () => {
    const exp = proposeAiExperiment({
      campaignId: 'camp-1',
      name: 'Executive CTA Wording A/B Test',
      hypothesis: 'Direct calendar link outperforms open question CTA for C-level personas.',
      targetCohort: 'VP Finance & CFOs',
      variantA: { name: 'Direct Calendar Link', content: 'Here is a 10-minute calendar link...' },
      variantB: { name: 'Open Question', content: 'Would you be open to a brief discussion this Thursday?' },
      primaryMetric: 'MEETING_BOOKING_RATE',
      requiredSampleSize: 100,
    });

    expect(exp.status).toBe('PROPOSED');

    // Simulate results
    exp.sampleCountA = 50;
    exp.positiveOutcomesA = 6; // 12%
    exp.sampleCountB = 50;
    exp.positiveOutcomesB = 2; // 4%

    const outcome = evaluateExperimentOutcome(exp);
    expect(outcome.concluded).toBe(true);
    expect(outcome.winnerVariant).toBe('A');
    expect(outcome.summary).toContain('Variant A won');
  });
});

describe('Phase 12: Playbook Evolution & Governance', () => {
  it('evolves playbook versions with explicit evidence basis and audit trail', () => {
    const current = {
      id: 'pb-v1',
      version: 'v1.0.0',
      title: 'Enterprise FinTech SDR Playbook',
      rules: ['Always reference recent funding round in touch 1'],
      objectionFrameworks: {},
      evidenceBasis: 'Initial baseline',
      evalBenchmarkScore: 88,
      proposedChangesSummary: 'Initial creation',
      isEffective: true,
      approvedBy: 'Director Dave',
      approvedAt: new Date('2026-01-01'),
      effectiveAt: new Date('2026-01-01'),
    };

    const evolved = evolvePlaybookVersion({
      currentVersion: current,
      newVersionNumber: 'v1.1.0',
      proposedChangesSummary: 'Add 2h reply SLA and shift cold outreach to Tuesday mornings',
      updatedRules: [
        'Always reference recent funding round in touch 1',
        'Prioritize Tuesday morning outreach for executive contacts',
      ],
      evidenceBasis: 'Experiment EXP-102 and Winning Pattern #44 data',
      evalBenchmarkScore: 94.5,
      approvedBy: 'Floor Manager Fiona',
    });

    expect(evolved.version).toBe('v1.1.0');
    expect(evolved.evalBenchmarkScore).toBe(94.5);
    expect(evolved.rules.length).toBe(2);
    expect(evolved.approvedBy).toBe('Floor Manager Fiona');
  });
});

describe('Phase 13: Campaign Autopsy & Cold Start', () => {
  it('generates structured retrospective and historical lookalike cold start plan', () => {
    const autopsy = generateCampaignAutopsy({
      campaignId: 'camp-finished',
      campaignName: 'Q1 Enterprise Cloud SDR',
      targetMeetings: 40,
      deliveredMeetings: 42,
      topPersonas: ['VP Infrastructure', 'Head of DevOps'],
      lowPersonas: ['Software Engineer'],
      bottlenecks: ['Lead inventory depleted on week 3'],
      learnings: ['DevOps leaders convert 2x faster with technical one-pagers'],
    });

    expect(autopsy.deliverySuccessRate).toBe(105);
    expect(autopsy.bestPerformingPersonas).toContain('VP Infrastructure');

    const coldStart = generateCampaignColdStartPlan({
      targetClientIndustry: 'FinTech',
      targetPersona: 'VP Finance',
      targetMeetings: 40,
    });

    expect(coldStart.recommendedStartingLeadVolume).toBeGreaterThanOrEqual(2000);
    expect(coldStart.recommendedPersonaMix.length).toBeGreaterThan(1);
    expect(coldStart.deliveryRiskMitigations.length).toBeGreaterThan(0);
  });
});
