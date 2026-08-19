/**
 * Telestar Campaign Digital Twin Engine (Directive Phase 5 §32, §33, §34).
 * Mathematical live simulation model tracking pacing, constraints, and calibrated delivery projections.
 */

export type CampaignHealthState = 'GREEN' | 'WATCH' | 'AT_RISK' | 'CRITICAL' | 'RECOVERING';

export interface DigitalTwinMetrics {
  campaignId: string;
  campaignName: string;
  targetMeetings: number;
  deliveredMeetings: number;
  remainingTarget: number;
  remainingBusinessDays: number;
  requiredMeetingVelocityPerDay: number;
  currentMeetingVelocityPerDay: number;
  eligibleLeadInventory: number;
  dailyLeadConsumptionRate: number;
  daysOfLeadSupplyRemaining: number;
  projectedDeliveryMin: number;
  projectedDeliveryMax: number;
  deliveryConfidence: number; // 0 to 100%
  healthState: CampaignHealthState;
  primaryConstraint: string | null;
  secondaryConstraints: string[];
}

export function simulateCampaignDigitalTwin(params: {
  campaignId: string;
  campaignName: string;
  targetMeetings: number;
  deliveredMeetings: number;
  remainingBusinessDays: number;
  eligibleLeadInventory: number;
  historicalMeetingRatePerLead: number; // e.g. 0.02 = 2% of leads book a meeting
  currentDailyOutreachVolume: number;
  positiveReplyRate: number; // e.g. 0.05 = 5%
  averageReplySlaHours: number;
}): DigitalTwinMetrics {
  const {
    campaignId,
    campaignName,
    targetMeetings,
    deliveredMeetings,
    remainingBusinessDays,
    eligibleLeadInventory,
    historicalMeetingRatePerLead,
    currentDailyOutreachVolume,
    averageReplySlaHours,
  } = params;

  const remainingTarget = Math.max(0, targetMeetings - deliveredMeetings);
  const requiredMeetingVelocityPerDay =
    remainingBusinessDays > 0 ? Number((remainingTarget / remainingBusinessDays).toFixed(2)) : remainingTarget;

  const dailyLeadConsumptionRate = Math.max(1, currentDailyOutreachVolume);
  const daysOfLeadSupplyRemaining = Math.floor(eligibleLeadInventory / dailyLeadConsumptionRate);

  // Projected meetings from available lead supply & time
  const leadsProcessedRemaining = Math.min(
    eligibleLeadInventory,
    remainingBusinessDays * dailyLeadConsumptionRate
  );

  const expectedAdditionalMeetings = leadsProcessedRemaining * historicalMeetingRatePerLead;

  // Calibrate projection range with uncertainty bounds (±15%)
  const projectedDeliveryMin = Math.floor(deliveredMeetings + expectedAdditionalMeetings * 0.85);
  const projectedDeliveryMax = Math.ceil(deliveredMeetings + expectedAdditionalMeetings * 1.15);

  const projectedMidpoint = (projectedDeliveryMin + projectedDeliveryMax) / 2;
  const deliveryConfidence = Math.min(
    99,
    Math.max(10, Math.round((projectedMidpoint / Math.max(1, targetMeetings)) * 100))
  );

  const secondaryConstraints: string[] = [];
  let primaryConstraint: string | null = null;
  let healthState: CampaignHealthState = 'GREEN';

  if (daysOfLeadSupplyRemaining < remainingBusinessDays) {
    primaryConstraint = `Lead supply exhaustion: Only ${daysOfLeadSupplyRemaining} days of inventory remaining vs ${remainingBusinessDays} required days.`;
  }

  if (averageReplySlaHours > 4) {
    secondaryConstraints.push(`SDR Reply SLA degraded (${averageReplySlaHours}h vs target <2h).`);
  }

  if (projectedDeliveryMax < targetMeetings) {
    healthState = deliveryConfidence < 60 ? 'CRITICAL' : 'AT_RISK';
  } else if (projectedDeliveryMin < targetMeetings || secondaryConstraints.length > 0) {
    healthState = 'WATCH';
  } else {
    healthState = 'GREEN';
  }

  return {
    campaignId,
    campaignName,
    targetMeetings,
    deliveredMeetings,
    remainingTarget,
    remainingBusinessDays,
    requiredMeetingVelocityPerDay,
    currentMeetingVelocityPerDay: Number(expectedAdditionalMeetings / Math.max(1, remainingBusinessDays)).toFixed(2) as unknown as number,
    eligibleLeadInventory,
    dailyLeadConsumptionRate,
    daysOfLeadSupplyRemaining,
    projectedDeliveryMin,
    projectedDeliveryMax,
    deliveryConfidence,
    healthState,
    primaryConstraint,
    secondaryConstraints,
  };
}
