// Campaign readiness score — a single 0-100 "can this campaign safely run well?" number
// composed from signals the campaign detail already carries. Pure; deterministic; no AI.
// Complements (does not replace) the hard launch gates + the synchronous suppression check.

export type CampaignReadinessInput = {
  stepCount: number;
  senderCount: number;
  liveSenderCount: number;
  enrolledCount: number;
  trackingEnabled: boolean;
  verifiedTrackingSenderCount: number;
  hasSchedule: boolean;
  outreachReadyLeadRatio?: number | null; // 0..1 share of enrolled leads that are reachable
};

export type ReadinessCheck = { key: string; label: string; ok: boolean; weight: number };

export type CampaignReadiness = {
  score: number; // 0-100
  band: "ready" | "almost" | "not_ready";
  checks: ReadinessCheck[];
  blockers: string[];
};

export function computeCampaignReadiness(input: CampaignReadinessInput): CampaignReadiness {
  const leadQualityOk = input.outreachReadyLeadRatio == null || input.outreachReadyLeadRatio >= 0.6;
  const checks: ReadinessCheck[] = [
    { key: "steps", label: "Email step + body", ok: input.stepCount > 0, weight: 20 },
    { key: "sender", label: "Sender in pool", ok: input.senderCount > 0, weight: 12 },
    { key: "live_sender", label: "A live-enabled sender", ok: input.liveSenderCount > 0, weight: 20 },
    { key: "leads", label: "Enrolled leads", ok: input.enrolledCount > 0, weight: 20 },
    { key: "schedule", label: "Send window configured", ok: input.hasSchedule, weight: 13 },
    {
      key: "tracking",
      label: "Tracking domain verified (if tracking on)",
      ok: !input.trackingEnabled || input.verifiedTrackingSenderCount > 0,
      weight: 5,
    },
    { key: "lead_quality", label: "Most enrolled leads are reachable", ok: leadQualityOk, weight: 10 },
  ];

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const gotWeight = checks.reduce((sum, c) => (c.ok ? sum + c.weight : sum), 0);
  const score = Math.round((gotWeight / totalWeight) * 100);
  const blockers = checks.filter((c) => !c.ok).map((c) => c.label);
  const band: CampaignReadiness["band"] = score >= 85 ? "ready" : score >= 55 ? "almost" : "not_ready";

  return { score, band, checks, blockers };
}
