export type OpportunitySummary = {
  totalOpen: number;
  pendingClientReview: number;
  acceptedByClient: number;
  won: number;
  lost: number;
  rejected: number;
  totalPipelineValue: number;
  weightedPipelineValue: number;
};

type SummaryOpp = {
  stage: string;
  status: string;
  value: string | number | null;
  probability: number;
};

export function buildSummary(opps: SummaryOpp[]): OpportunitySummary {
  let totalPipelineValue = 0;
  let weightedPipelineValue = 0;

  for (const opp of opps) {
    if (opp.status === 'open' && opp.value != null) {
      const v = typeof opp.value === 'string' ? Number(opp.value) : opp.value;
      if (Number.isFinite(v) && v > 0) {
        totalPipelineValue += v;
        weightedPipelineValue += v * (opp.probability / 100);
      }
    }
  }

  return {
    totalOpen: opps.filter((o) => o.status === 'open').length,
    pendingClientReview: opps.filter((o) => o.stage === 'pending_client_review' && o.status === 'open').length,
    acceptedByClient: opps.filter((o) => o.stage === 'accepted_by_client' && o.status === 'open').length,
    won: opps.filter((o) => o.status === 'won').length,
    lost: opps.filter((o) => o.status === 'lost').length,
    rejected: opps.filter((o) => o.status === 'rejected').length,
    totalPipelineValue,
    weightedPipelineValue,
  };
}

export function acceptanceRate(accepted: number, submitted: number): number {
  if (submitted <= 0) return 0;
  return Math.round((accepted / submitted) * 1000) / 10;
}

export function ageInStage(opp: { stageEnteredAt?: Date | null; createdAt?: Date | null }, now = new Date()): number {
  const base = opp.stageEnteredAt ?? opp.createdAt;
  if (!base) return 0;
  const ms = now.getTime() - base.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
