import { EmailHealthLevelValue } from './types';

export interface CapAdjustmentRecommendation {
  originalCap: number;
  recommendedCap: number;
  reductionPercentage: number;
  shouldAutoPause: boolean;
  reason: string;
  isAdjusted: boolean;
}

/**
 * Calculates safety cap adjustments for an email account based on health band,
 * bounce rate, and spam complaint metrics.
 */
export function calculateSafetyCapAdjustment(params: {
  currentDailyCap: number;
  healthBand: EmailHealthLevelValue | 'good' | 'fair' | 'poor' | 'critical';
  bounceRate7d: number; // 0.0 to 1.0
  spamComplaintRate7d?: number;
  isWarmup?: boolean;
}): CapAdjustmentRecommendation {
  const currentCap = Math.max(1, params.currentDailyCap || 50);

  // 1. Critical Health or Severe Bounce (>8%) -> Immediate Safety Pause Recommendation
  if (params.healthBand === 'critical' || params.bounceRate7d > 0.08 || (params.spamComplaintRate7d && params.spamComplaintRate7d > 0.003)) {
    return {
      originalCap: currentCap,
      recommendedCap: 0,
      reductionPercentage: 100,
      shouldAutoPause: true,
      reason: 'Critical deliverability risk detected (high bounce rate or critical health band). Account should be paused to protect domain reputation.',
      isAdjusted: true,
    };
  }

  // 2. Poor Health or High Bounce (5% - 8%) -> 70% Cap Reduction
  if (params.healthBand === 'poor' || params.bounceRate7d > 0.05) {
    const recommendedCap = Math.max(10, Math.floor(currentCap * 0.3));
    return {
      originalCap: currentCap,
      recommendedCap,
      reductionPercentage: Math.round(((currentCap - recommendedCap) / currentCap) * 100),
      shouldAutoPause: false,
      reason: 'Elevated bounce rate (>5%) or poor health band. Daily sending volume throttled by 70%.',
      isAdjusted: true,
    };
  }

  // 3. Fair Health or Moderate Bounce (2.5% - 5%) -> 40% Cap Reduction
  if (params.healthBand === 'fair' || params.bounceRate7d > 0.025) {
    const recommendedCap = Math.max(15, Math.floor(currentCap * 0.6));
    return {
      originalCap: currentCap,
      recommendedCap,
      reductionPercentage: Math.round(((currentCap - recommendedCap) / currentCap) * 100),
      shouldAutoPause: false,
      reason: 'Moderate bounce rate (2.5–5%). Sending throttled by 40% while contact data is verified.',
      isAdjusted: true,
    };
  }

  // 4. Good Health -> Maintain standard cap
  return {
    originalCap: currentCap,
    recommendedCap: currentCap,
    reductionPercentage: 0,
    shouldAutoPause: false,
    reason: 'Account health is good. Operating at full configured capacity.',
    isAdjusted: false,
  };
}
