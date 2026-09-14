/**
 * Summarise a fan-out of per-lead requests into one honest toast.
 *
 * The Leads page bulk actions ran `Promise.all(ids.map(fetch…))` and then, without reading a
 * single response, toasted "Stage updated for N leads". A 403 on half of them, a validation
 * error, a lead that no longer existed — all reported as success. A manager doing a bulk
 * reassignment believed every lead had moved.
 *
 * `Promise.allSettled` plus `res.ok` per response gives the real count. The message says what
 * happened; the tone tells the toast how to show it.
 */
export type FanOutResult = PromiseSettledResult<Response>;

export type BulkOutcome = {
  ok: number;
  failed: number;
  message: string;
  tone: 'success' | 'warning' | 'error';
};

export function summarizeBulk(verb: string, noun: string, results: FanOutResult[]): BulkOutcome {
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
  const failed = results.length - ok;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;

  if (failed === 0) return { ok, failed, tone: 'success', message: `${verb} ${plural(ok)}` };
  if (ok === 0) return { ok, failed, tone: 'error', message: `${verb} failed for ${plural(failed)}` };
  return { ok, failed, tone: 'warning', message: `${verb} ${plural(ok)}; ${failed} failed` };
}
