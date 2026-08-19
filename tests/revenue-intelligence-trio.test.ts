import { describe, it, expect } from 'vitest';
import { simulateCampaignDigitalTwin } from '@/lib/ai/campaignDigitalTwin';
import { evaluateDeliveryGuardian } from '@/lib/ai/deliveryGuardian';
import { simulateScenario } from '@/lib/ai/scenarioSimulator';

describe('Phase 5: Campaign Digital Twin', () => {
  it('accurately calculates pacing, lead supply exhaustion, and delivery confidence', () => {
    const twin = simulateCampaignDigitalTwin({
      campaignId: 'camp-acme-1',
      campaignName: 'ACME Finance Director Outreach',
      targetMeetings: 40,
      deliveredMeetings: 12,
      remainingBusinessDays: 14,
      eligibleLeadInventory: 300, // 300 leads / 40/day = 7.5 days supply vs 14 days needed -> Supply shortage!
      historicalMeetingRatePerLead: 0.02,
      currentDailyOutreachVolume: 40,
      positiveReplyRate: 0.04,
      averageReplySlaHours: 5.5, // degraded SLA
    });

    expect(twin.targetMeetings).toBe(40);
    expect(twin.deliveredMeetings).toBe(12);
    expect(twin.daysOfLeadSupplyRemaining).toBe(7);
    expect(twin.primaryConstraint).toContain('Lead supply exhaustion');
    expect(twin.secondaryConstraints[0]).toContain('SDR Reply SLA degraded');
    expect(['WATCH', 'AT_RISK', 'CRITICAL']).toContain(twin.healthState);
  });
});

describe('Phase 6: Delivery Guardian', () => {
  it('generates prioritized trade-off evaluated recovery options for at-risk campaigns', () => {
    const twin = simulateCampaignDigitalTwin({
      campaignId: 'camp-acme-1',
      campaignName: 'ACME Finance Director Outreach',
      targetMeetings: 40,
      deliveredMeetings: 15,
      remainingBusinessDays: 10,
      eligibleLeadInventory: 200,
      historicalMeetingRatePerLead: 0.02,
      currentDailyOutreachVolume: 40,
      positiveReplyRate: 0.04,
      averageReplySlaHours: 4.5,
    });

    const guardian = evaluateDeliveryGuardian(twin);
    expect(guardian.recoveryOptions.length).toBeGreaterThanOrEqual(3);
    expect(guardian.recoveryOptions.some((o) => o.optionId === 'OPTION_A')).toBe(true);
    expect(guardian.recoveryOptions.some((o) => o.optionId === 'OPTION_D')).toBe(true);
    expect(guardian.recommendedOptionId).toBe('OPTION_D');
    expect(guardian.consequenceOfNoAction).toContain('shortfall');
  });
});

describe('Phase 7: Scenario Simulator', () => {
  it('models management what-if questions with distinct FACT / ASSUMPTION / FORECAST labels', () => {
    const twin = simulateCampaignDigitalTwin({
      campaignId: 'camp-acme-1',
      campaignName: 'ACME Finance Director Outreach',
      targetMeetings: 40,
      deliveredMeetings: 20,
      remainingBusinessDays: 10,
      eligibleLeadInventory: 400,
      historicalMeetingRatePerLead: 0.02,
      currentDailyOutreachVolume: 40,
      positiveReplyRate: 0.04,
      averageReplySlaHours: 2.0,
    });

    const sim = simulateScenario(
      twin,
      {
        leadInventoryDelta: 300,
        sdrCountDelta: 1,
      },
      'Add 1 SDR + 300 ICP Leads'
    );

    expect(sim.netMeetingDeltaMin).toBeGreaterThan(0);
    expect(sim.simulatedProjectedDelivery.max).toBeGreaterThan(twin.projectedDeliveryMax);
    expect(sim.facts.some((f) => f.startsWith('[FACT]'))).toBe(true);
    expect(sim.assumptions.some((a) => a.startsWith('[ASSUMPTION]'))).toBe(true);
    expect(sim.forecasts.some((f) => f.startsWith('[FORECAST]'))).toBe(true);
  });
});
