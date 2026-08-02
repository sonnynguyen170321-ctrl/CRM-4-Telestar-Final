export interface DeliverabilityThresholds {
  maxBounceRateWarning: number;   // e.g. 0.02 (2%)
  maxBounceRateCritical: number;  // e.g. 0.05 (5%)
  maxSpamRateWarning: number;     // e.g. 0.0005 (0.05%)
  maxSpamRateCritical: number;    // e.g. 0.001 (0.1%)
  minReplyRateTarget: number;     // e.g. 0.01 (1%)
  minHealthScoreWarning: number;  // e.g. 70
  minHealthScoreCritical: number; // e.g. 50
}

export const DEFAULT_DELIVERABILITY_THRESHOLDS: DeliverabilityThresholds = {
  maxBounceRateWarning: 0.02,
  maxBounceRateCritical: 0.05,
  maxSpamRateWarning: 0.0005,
  maxSpamRateCritical: 0.001,
  minReplyRateTarget: 0.01,
  minHealthScoreWarning: 70,
  minHealthScoreCritical: 50,
};

export interface ThresholdComplianceResult {
  status: 'compliant' | 'warning' | 'breached';
  violations: string[];
  warnings: string[];
  metrics: {
    bounceRate: number;
    spamRate: number;
    replyRate: number;
    healthScore: number;
  };
}

/**
 * Checks whether an entity (account, campaign, or client aggregate) meets
 * configured or default deliverability thresholds.
 */
export function evaluateDeliverabilityCompliance(
  metrics: {
    bounceRate: number;
    spamRate?: number;
    replyRate: number;
    healthScore: number;
  },
  customThresholds?: Partial<DeliverabilityThresholds>
): ThresholdComplianceResult {
  const thresholds: DeliverabilityThresholds = {
    ...DEFAULT_DELIVERABILITY_THRESHOLDS,
    ...customThresholds,
  };

  const violations: string[] = [];
  const warnings: string[] = [];
  const spamRate = metrics.spamRate ?? 0;

  // Bounce Rate Check
  if (metrics.bounceRate >= thresholds.maxBounceRateCritical) {
    violations.push(`Bounce rate of ${(metrics.bounceRate * 100).toFixed(2)}% exceeds critical threshold of ${(thresholds.maxBounceRateCritical * 100).toFixed(1)}%.`);
  } else if (metrics.bounceRate >= thresholds.maxBounceRateWarning) {
    warnings.push(`Bounce rate of ${(metrics.bounceRate * 100).toFixed(2)}% is in warning zone (threshold ${(thresholds.maxBounceRateWarning * 100).toFixed(1)}%).`);
  }

  // Spam Rate Check
  if (spamRate >= thresholds.maxSpamRateCritical) {
    violations.push(`Spam complaint rate of ${(spamRate * 100).toFixed(3)}% exceeds critical threshold of ${(thresholds.maxSpamRateCritical * 100).toFixed(2)}%.`);
  } else if (spamRate >= thresholds.maxSpamRateWarning) {
    warnings.push(`Spam complaint rate of ${(spamRate * 100).toFixed(3)}% is elevated.`);
  }

  // Health Score Check
  if (metrics.healthScore < thresholds.minHealthScoreCritical) {
    violations.push(`Health score of ${metrics.healthScore} is below critical threshold of ${thresholds.minHealthScoreCritical}.`);
  } else if (metrics.healthScore < thresholds.minHealthScoreWarning) {
    warnings.push(`Health score of ${metrics.healthScore} is below recommended target of ${thresholds.minHealthScoreWarning}.`);
  }

  // Reply Rate Target Check (Non-critical advisory)
  if (metrics.replyRate < thresholds.minReplyRateTarget) {
    warnings.push(`Reply rate of ${(metrics.replyRate * 100).toFixed(2)}% is below minimum target of ${(thresholds.minReplyRateTarget * 100).toFixed(1)}%.`);
  }

  const status: 'compliant' | 'warning' | 'breached' =
    violations.length > 0 ? 'breached' : warnings.length > 0 ? 'warning' : 'compliant';

  return {
    status,
    violations,
    warnings,
    metrics: {
      bounceRate: metrics.bounceRate,
      spamRate,
      replyRate: metrics.replyRate,
      healthScore: metrics.healthScore,
    },
  };
}
