/**
 * Telestar Winning Pattern Engine (Directive Phase 10 §45, §46).
 * Empirical multi-dimensional outcome correlation discovery with sample-size weighting.
 */

export interface PatternObservation {
  dimension: 'PERSONA' | 'INDUSTRY' | 'TIMING' | 'CHANNEL' | 'OBJECTION_RESPONSE' | 'SEQUENCE_STEP';
  key: string;
  sampleSize: number;
  conversionRate: number; // e.g. 0.08 = 8% positive reply or meeting
  baselineConversionRate: number;
  deltaPercent: number; // e.g. +35%
  confidence: 'LOW' | 'MODERATE' | 'HIGH';
  evidenceStatement: string;
}

export function evaluatePatternEvidence(params: {
  dimension: PatternObservation['dimension'];
  key: string;
  sampleSize: number;
  positiveCount: number;
  baselineRate: number;
}): PatternObservation {
  const conversionRate = params.sampleSize > 0 ? params.positiveCount / params.sampleSize : 0;
  const deltaPercent = params.baselineRate > 0 ? ((conversionRate - params.baselineRate) / params.baselineRate) * 100 : 0;

  let confidence: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  if (params.sampleSize >= 200) confidence = 'HIGH';
  else if (params.sampleSize >= 50) confidence = 'MODERATE';

  const sign = deltaPercent >= 0 ? '+' : '';
  const evidenceStatement = `In ${params.sampleSize} comparable touches, "${params.key}" demonstrated a ${sign}${deltaPercent.toFixed(1)}% conversion delta against campaign baseline (${(conversionRate * 100).toFixed(1)}% vs ${(params.baselineRate * 100).toFixed(1)}%). Confidence is ${confidence.toLowerCase()}.`;

  return {
    dimension: params.dimension,
    key: params.key,
    sampleSize: params.sampleSize,
    conversionRate: Number(conversionRate.toFixed(3)),
    baselineConversionRate: Number(params.baselineRate.toFixed(3)),
    deltaPercent: Number(deltaPercent.toFixed(1)),
    confidence,
    evidenceStatement,
  };
}
