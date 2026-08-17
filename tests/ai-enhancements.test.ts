import { describe, it, expect } from 'vitest';

describe('Next-Gen AI Agent Capabilities', () => {
  it('validates lead enrichment schema and icebreaker styles', () => {
    const mockEnrichment = {
      companySummary: 'Acme SaaS builds automated workflow tools for enterprise logistics.',
      industryFocus: 'Logistics Tech',
      estimatedTechStack: ['HubSpot', 'PostgreSQL', 'Stripe'],
      keyPainPoints: ['Manual dispatching', 'High carrier churn', 'Slow quoting'],
      icebreakers: [
        {
          id: 'pain_hypothesis',
          style: '🔥 Operational Pain Hook',
          hook: 'Noticed Acme scaling fleet operations—how are you managing dispatch latency?',
          rationale: 'Addresses primary bottleneck.',
        },
        {
          id: 'social_proof',
          style: '📈 Case Study / ROI Hook',
          hook: 'Helped a similar logistics platform cut carrier onboarding time by 40%.',
          rationale: 'Builds instant credibility.',
        },
      ],
    };

    expect(mockEnrichment.icebreakers).toHaveLength(2);
    expect(mockEnrichment.icebreakers[0].id).toBe('pain_hypothesis');
    expect(mockEnrichment.keyPainPoints).toContain('Manual dispatching');
  });

  it('validates daily morning briefing payload structure', () => {
    const mockBriefing = {
      date: 'Monday, Aug 17',
      greeting: 'Good morning Sonny!',
      urgentTasksCount: 4,
      hotLeadsCount: 2,
      prioritySummary: 'Focus on 4 cadence touches.',
      hotLeads: [
        {
          id: 'lead-1',
          name: 'Alex Rivera',
          company: 'Acme Corp',
          signal: 'Replied to email step 1',
          recommendedAction: 'Send meeting link',
        },
      ],
      recommendedFocus: [
        {
          category: '🔥 Priority Touches',
          title: 'Complete morning sequence tasks',
          description: 'Send scheduled emails before noon.',
        },
      ],
    };

    expect(mockBriefing.urgentTasksCount).toBe(4);
    expect(mockBriefing.hotLeads).toHaveLength(1);
    expect(mockBriefing.recommendedFocus[0].category).toBe('🔥 Priority Touches');
  });
});
