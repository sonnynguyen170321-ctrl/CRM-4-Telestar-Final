/**
 * Call `POST /api/leads/rescore-icp` batch after batch until the server says there is nothing
 * left, and add the batches up. Browser-side; the server bounds each call.
 *
 * Before this, both rescore buttons made one call and told the operator to "run again" — which
 * re-read the same first 500 leads, so a 1,692-lead campaign never got past lead 500 (2026-10-07).
 */
export type RescoreAllTotals = {
  scored: number;
  notScored: number;
  reasons: Record<string, number>;
  transitions: Record<string, number>;
  unchanged: number;
  pinned: number;
  /** True when the safety cap stopped the loop before the server ran out of leads. */
  stoppedEarly: boolean;
};

type BatchReport = Partial<Omit<RescoreAllTotals, 'stoppedEarly'>> & { nextCursor?: string | null };

/** 200 batches of 500 is 100,000 leads: far above any tenant, low enough to stop a runaway loop. */
const MAX_BATCHES = 200;

const add = (into: Record<string, number>, from: Record<string, number> | undefined) => {
  for (const [key, value] of Object.entries(from ?? {})) into[key] = (into[key] ?? 0) + value;
};

export async function rescoreAllLeads(
  body: { campaignId?: string; onlyUnscored?: boolean; dryRun?: boolean },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; totals: RescoreAllTotals } | { ok: false; response: Response }> {
  const totals: RescoreAllTotals = { scored: 0, notScored: 0, reasons: {}, transitions: {}, unchanged: 0, pinned: 0, stoppedEarly: false };
  let cursor: string | undefined;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const response = await fetchImpl('/api/leads/rescore-icp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...(cursor ? { cursor } : {}) }),
    });
    if (!response.ok) return { ok: false, response };

    const report = (await response.json()) as BatchReport;
    totals.scored += report.scored ?? 0;
    totals.notScored += report.notScored ?? 0;
    totals.unchanged += report.unchanged ?? 0;
    totals.pinned += report.pinned ?? 0;
    add(totals.reasons, report.reasons);
    add(totals.transitions, report.transitions);

    if (!report.nextCursor) return { ok: true, totals };
    cursor = report.nextCursor;
  }
  return { ok: true, totals: { ...totals, stoppedEarly: true } };
}
