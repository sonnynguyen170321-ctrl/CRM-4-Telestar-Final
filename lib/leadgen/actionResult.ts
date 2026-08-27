/**
 * Toast text for a leadgen-pool bulk action.
 *
 * `convertPoolToLeads` does not throw on a record it cannot convert — it collects
 * `{ poolItemId, reason }` into `errors` and keeps going, so the HTTP response is a 200
 * whether every record converted or none did. The console read only `count`, which turned
 * "nothing converted, here is why" into a green `Converted (0)` and dropped the reasons.
 *
 * Pure and response-shape tolerant on purpose: an action that answers something else
 * (`qualify`, `assign`) still gets its plain success label.
 */
export type PoolActionTone = 'success' | 'warning' | 'error';

export interface PoolActionResult {
  message: string;
  tone: PoolActionTone;
}

interface PoolActionError {
  reason?: unknown;
}

const MAX_REASONS_SHOWN = 3;

/**
 * Wording for the reason codes the pool service emits.
 *
 * The codes are stable identifiers for callers; this is what a person reads. Anything absent
 * falls through unchanged, so a new code degrades to its raw form rather than to silence.
 */
const REASON_WORDING: Record<string, string> = {
  already_a_lead_in_this_campaign: 'already a lead in this campaign',
  no_sdr_available: 'no SDR selected to receive them',
};

function wordFor(reason: string): string {
  return REASON_WORDING[reason] ?? reason;
}

export function formatPoolActionResult(okLabel: string, data: unknown): PoolActionResult {
  const body = isRecord(data) ? data : {};
  const count = typeof body.count === 'number' ? body.count : null;
  const errors = Array.isArray(body.errors) ? (body.errors as PoolActionError[]) : [];

  const succeeded = count === null ? okLabel : `${okLabel} (${count})`;

  if (errors.length === 0) {
    return { message: succeeded, tone: 'success' };
  }

  const failed = `${errors.length} failed: ${describeReasons(errors)}`;

  // Nothing landed — the action did not do what its label claims, so it is not a warning.
  if (count === 0) {
    return { message: `${okLabel} nothing · ${failed}`, tone: 'error' };
  }

  return { message: `${succeeded} · ${failed}`, tone: 'warning' };
}

/** Distinct reasons, capped — 200 duplicate rows should not render 200 identical clauses. */
function describeReasons(errors: PoolActionError[]): string {
  const reasons = [
    ...new Set(errors.map((e) => wordFor(typeof e.reason === 'string' ? e.reason : 'unknown'))),
  ];
  const shown = reasons.slice(0, MAX_REASONS_SHOWN).join(', ');
  return reasons.length > MAX_REASONS_SHOWN ? `${shown}, …` : shown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
