/**
 * Telestar Scenario Simulator Engine (Directive Phase 7 §37, §38).
 * Mathematical simulation engine for management what-if questions with explicit FACT / ASSUMPTION / FORECAST labels.
 */

import { type DigitalTwinMetrics } from './campaignDigitalTwin';

export interface SimulationVariableDelta {
  sdrCountDelta?: number; // e.g. +1 SDR
  replyRatePercentDelta?: number; // e.g. +2%
  leadInventoryDelta?: number; // e.g. +300 leads
  replySlaHoursDelta?: number; // e.g. -2 hours
}

export interface SimulationResult {
  scenarioName: string;
  baselineProjectedDelivery: { min: number; max: number };
  simulatedProjectedDelivery: { min: number; max: number };
  netMeetingDeltaMin: number;
  netMeetingDeltaMax: number;
  deliveryConfidenceDelta: number;
  facts: string[];
  assumptions: string[];
  forecasts: string[];
}

export function simulateScenario(
  twin: DigitalTwinMetrics,
  delta: SimulationVariableDelta,
  scenarioName = 'Custom What-If Scenario'
): SimulationResult {
  const facts: string[] = [
    `[FACT] Target: ${twin.targetMeetings} meetings across ${twin.remainingBusinessDays} remaining business days.`,
    `[FACT] Delivered to date: ${twin.deliveredMeetings} meetings with ${twin.eligibleLeadInventory} available leads.`,
  ];

  const assumptions: string[] = [];
  let addedMeetingsMin = 0;
  let addedMeetingsMax = 0;

  // 1. Lead injection delta
  if (delta.leadInventoryDelta) {
    assumptions.push(
      `[ASSUMPTION] Fresh lead supply of ${delta.leadInventoryDelta} converts at historical 2.0% meeting rate (±0.3%).`
    );
    const converted = delta.leadInventoryDelta * 0.02;
    addedMeetingsMin += Math.floor(converted * 0.85);
    addedMeetingsMax += Math.ceil(converted * 1.15);
  }

  // 2. SDR capacity addition delta
  if (delta.sdrCountDelta) {
    assumptions.push(
      `[ASSUMPTION] Adding ${delta.sdrCountDelta} SDR increases daily outreach capacity by ${delta.sdrCountDelta * 40} touches/day.`
    );
    const sdrOutreach = delta.sdrCountDelta * 40 * twin.remainingBusinessDays;
    const additionalLeadsProcessed = Math.min(
      twin.eligibleLeadInventory + (delta.leadInventoryDelta || 0),
      sdrOutreach
    );
    const sdrMeetings = additionalLeadsProcessed * 0.015;
    addedMeetingsMin += Math.floor(sdrMeetings * 0.8);
    addedMeetingsMax += Math.ceil(sdrMeetings * 1.2);
  }

  // 3. Reply rate improvement delta
  if (delta.replyRatePercentDelta) {
    assumptions.push(
      `[ASSUMPTION] Improving positive reply rate by +${delta.replyRatePercentDelta}% yields +${Math.round(twin.eligibleLeadInventory * (delta.replyRatePercentDelta / 100) * 0.3)} meetings.`
    );
    const replyMeetings = twin.eligibleLeadInventory * (delta.replyRatePercentDelta / 100) * 0.3;
    addedMeetingsMin += Math.floor(replyMeetings * 0.8);
    addedMeetingsMax += Math.ceil(replyMeetings * 1.2);
  }

  const simulatedMin = twin.projectedDeliveryMin + addedMeetingsMin;
  const simulatedMax = twin.projectedDeliveryMax + addedMeetingsMax;
  const simulatedConfidence = Math.min(
    99,
    Math.round(((simulatedMin + simulatedMax) / 2 / Math.max(1, twin.targetMeetings)) * 100)
  );

  const forecasts: string[] = [
    `[FORECAST] Projected outcome improves from ${twin.projectedDeliveryMin}–${twin.projectedDeliveryMax} to ${simulatedMin}–${simulatedMax} meetings.`,
    `[FORECAST] Delivery confidence shifts from ${twin.deliveryConfidence}% to ${simulatedConfidence}%.`,
  ];

  return {
    scenarioName,
    baselineProjectedDelivery: { min: twin.projectedDeliveryMin, max: twin.projectedDeliveryMax },
    simulatedProjectedDelivery: { min: simulatedMin, max: simulatedMax },
    netMeetingDeltaMin: addedMeetingsMin,
    netMeetingDeltaMax: addedMeetingsMax,
    deliveryConfidenceDelta: simulatedConfidence - twin.deliveryConfidence,
    facts,
    assumptions,
    forecasts,
  };
}
