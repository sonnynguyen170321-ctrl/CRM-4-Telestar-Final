/**
 * Telestar Delivery Guardian Engine (Directive Phase 6 §35, §36).
 * Early risk detection and trade-off evaluated recovery option generation.
 */

import { type DigitalTwinMetrics } from './campaignDigitalTwin';

export interface RecoveryOption {
  optionId: 'OPTION_A' | 'OPTION_B' | 'OPTION_C' | 'OPTION_D';
  title: string;
  strategy: string;
  expectedDeliveryDelta: number; // e.g. +5 meetings
  operationalCostOrTradeoff: string;
  dependencies: string[];
  risks: string[];
  requiredApprovals: string[];
}

export interface DeliveryGuardianAssessment {
  campaignId: string;
  campaignName: string;
  healthState: string;
  deliveryConfidence: number;
  rootCause: string;
  consequenceOfNoAction: string;
  recoveryOptions: RecoveryOption[];
  recommendedOptionId: string;
}

export function evaluateDeliveryGuardian(twin: DigitalTwinMetrics): DeliveryGuardianAssessment {
  const isShortfall = twin.projectedDeliveryMax < twin.targetMeetings;
  const shortfallCount = Math.max(0, twin.targetMeetings - twin.projectedDeliveryMin);

  const rootCause =
    twin.primaryConstraint ||
    (twin.secondaryConstraints.length > 0
      ? twin.secondaryConstraints.join('; ')
      : 'Campaign execution on pace without critical bottlenecks.');

  const consequenceOfNoAction = isShortfall
    ? `Likely shortfall of ${shortfallCount} meetings against client target of ${twin.targetMeetings}. Risk of client escalation or SLA penalty.`
    : 'Maintain current cadence to safely deliver agreed client commitments.';

  const recoveryOptions: RecoveryOption[] = [];

  if (isShortfall || twin.healthState === 'WATCH') {
    // Option A: Source fresh leads
    recoveryOptions.push({
      optionId: 'OPTION_A',
      title: 'Accelerate ICP Lead Sourcing',
      strategy: `Source and verify +${Math.ceil(shortfallCount * 50)} additional qualified contacts to eliminate inventory deficit.`,
      expectedDeliveryDelta: shortfallCount,
      operationalCostOrTradeoff: 'Requires Leadgen sourcing capacity allocation for 2 business days.',
      dependencies: ['Leadgen Manager ICP approval'],
      risks: ['Data verification delay'],
      requiredApprovals: ['Leadgen Manager'],
    });

    // Option B: Relationship asset reallocation
    recoveryOptions.push({
      optionId: 'OPTION_B',
      title: 'Reallocate Eligible Relationship Capital Assets',
      strategy: 'Reallocate 65 eligible warm commercial contacts from completed campaigns.',
      expectedDeliveryDelta: Math.ceil(shortfallCount * 0.7),
      operationalCostOrTradeoff: 'Depletes shared relationship inventory for other future campaigns.',
      dependencies: ['Conflict-aware client lock check'],
      risks: ['Contact messaging fatigue if previously touched in last 90 days'],
      requiredApprovals: ['Floor Manager'],
    });

    // Option C: Reply SLA tightening
    recoveryOptions.push({
      optionId: 'OPTION_C',
      title: 'Enforce 2-Hour Hot Reply SLA & Multi-Touch Calling',
      strategy: 'Reassign overdue positive replies and add same-day call touches on interested prospects.',
      expectedDeliveryDelta: Math.ceil(shortfallCount * 0.5),
      operationalCostOrTradeoff: 'Increases SDR daily calling requirements.',
      dependencies: ['Team Lead daily floor inspection'],
      risks: ['SDR bandwidth compression'],
      requiredApprovals: ['Team Lead'],
    });

    // Option D: Combined Recovery Program
    recoveryOptions.push({
      optionId: 'OPTION_D',
      title: 'Combined Recovery Mission (Sourcing + SLA + Reallocation)',
      strategy: 'Comprehensive recovery combining +200 fresh leads, 40 warm relationship re-engagements, and strict 2h reply SLA.',
      expectedDeliveryDelta: shortfallCount + 3,
      operationalCostOrTradeoff: 'Cross-functional coordination between Leadgen, SDR floor, and Floor Manager.',
      dependencies: ['Director approval of recovery mission'],
      risks: ['None (fully diversifies recovery risk across supply and execution)'],
      requiredApprovals: ['Director', 'Floor Manager'],
    });
  }

  return {
    campaignId: twin.campaignId,
    campaignName: twin.campaignName,
    healthState: twin.healthState,
    deliveryConfidence: twin.deliveryConfidence,
    rootCause,
    consequenceOfNoAction,
    recoveryOptions,
    recommendedOptionId: recoveryOptions.length > 0 ? 'OPTION_D' : 'OPTION_A',
  };
}
