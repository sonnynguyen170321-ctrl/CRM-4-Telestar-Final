/**
 * Telestar Revenue Experiment Lab (Directive Phase 11 §47, §48, §49).
 * Controlled A/B/n experiment framework measured down-funnel against qualified meetings.
 */

export type ExperimentStatus = 'PROPOSED' | 'APPROVED' | 'ACTIVE' | 'CONCLUDED' | 'REJECTED';

export interface RevenueExperiment {
  id: string;
  campaignId: string;
  name: string;
  hypothesis: string;
  targetCohort: string;
  variantA: { name: string; content: string };
  variantB: { name: string; content: string };
  primaryMetric: 'POSITIVE_REPLY_RATE' | 'MEETING_BOOKING_RATE' | 'ACCEPTED_MEETING_RATE';
  requiredSampleSize: number;
  sampleCountA: number;
  sampleCountB: number;
  positiveOutcomesA: number;
  positiveOutcomesB: number;
  status: ExperimentStatus;
  proposedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  winnerVariant?: 'A' | 'B' | 'INCONCLUSIVE' | null;
}

export function proposeAiExperiment(params: {
  campaignId: string;
  name: string;
  hypothesis: string;
  targetCohort: string;
  variantA: { name: string; content: string };
  variantB: { name: string; content: string };
  primaryMetric: RevenueExperiment['primaryMetric'];
  requiredSampleSize?: number;
}): RevenueExperiment {
  return {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    campaignId: params.campaignId,
    name: params.name,
    hypothesis: params.hypothesis,
    targetCohort: params.targetCohort,
    variantA: params.variantA,
    variantB: params.variantB,
    primaryMetric: params.primaryMetric,
    requiredSampleSize: params.requiredSampleSize || 200,
    sampleCountA: 0,
    sampleCountB: 0,
    positiveOutcomesA: 0,
    positiveOutcomesB: 0,
    status: 'PROPOSED',
    proposedBy: 'Telestar AI Experiment Lab',
  };
}

export function evaluateExperimentOutcome(exp: RevenueExperiment): {
  concluded: boolean;
  winnerVariant: 'A' | 'B' | 'INCONCLUSIVE';
  rateA: number;
  rateB: number;
  summary: string;
} {
  const rateA = exp.sampleCountA > 0 ? exp.positiveOutcomesA / exp.sampleCountA : 0;
  const rateB = exp.sampleCountB > 0 ? exp.positiveOutcomesB / exp.sampleCountB : 0;
  const totalSamples = exp.sampleCountA + exp.sampleCountB;

  if (totalSamples < exp.requiredSampleSize) {
    return {
      concluded: false,
      winnerVariant: 'INCONCLUSIVE',
      rateA: Number(rateA.toFixed(3)),
      rateB: Number(rateB.toFixed(3)),
      summary: `Experiment in progress: ${totalSamples}/${exp.requiredSampleSize} required touches completed.`,
    };
  }

  let winnerVariant: 'A' | 'B' | 'INCONCLUSIVE' = 'INCONCLUSIVE';
  if (rateA > rateB * 1.15 && exp.positiveOutcomesA >= 5) winnerVariant = 'A';
  else if (rateB > rateA * 1.15 && exp.positiveOutcomesB >= 5) winnerVariant = 'B';

  return {
    concluded: true,
    winnerVariant,
    rateA: Number(rateA.toFixed(3)),
    rateB: Number(rateB.toFixed(3)),
    summary: `Concluded (${totalSamples} touches): Variant ${winnerVariant} won with ${(Math.max(rateA, rateB) * 100).toFixed(1)}% conversion vs ${(Math.min(rateA, rateB) * 100).toFixed(1)}%.`,
  };
}
