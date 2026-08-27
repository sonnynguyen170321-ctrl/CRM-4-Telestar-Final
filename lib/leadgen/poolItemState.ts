/**
 * Derived states of an internal-database (pool) record.
 *
 * Routing and conversion are two different writes. `assignPoolItems` tags the pool row with a
 * campaign and/or SDR; only `convertPoolToLeads` creates the `Lead` the rep actually works.
 * A record can therefore name an SDR while that SDR has nothing in their lead space — the
 * gap this module makes visible.
 */
export interface PoolRoutingFields {
  assignedSdrId: string | null;
  assignedCampaignId: string | null;
  convertedLeadId: string | null;
  /** Present on every record the API returns; optional so older callers still compile. */
  qualification?: string | null;
  status?: string | null;
}

/** Verdicts that retire a record — it will never be converted, and should stop being flagged. */
const RETIRED_QUALIFICATIONS = new Set([
  'duplicate',
  'disqualified',
  'invalid_contact',
  'invalid_company',
  'out_of_icp',
]);

/**
 * Routed to a campaign or rep, but no `Lead` exists yet — the rep cannot see it.
 *
 * Retirement is an answer to the question this asks. Marking a record `duplicate` does not
 * clear `assignedSdrId`, so a predicate reading only assignment keeps flagging records nobody
 * should convert: measured on production 2026-08-27, six records retired as duplicates still
 * showed "not converted", inviting a second conversion of prospects that were already live
 * pipeline — one of them a closed win. An archived or rejected record waits for nothing.
 */
export function isAwaitingConversion(item: PoolRoutingFields): boolean {
  if (item.convertedLeadId) return false;
  if (item.status === 'archived') return false;
  if (item.qualification && RETIRED_QUALIFICATIONS.has(item.qualification)) return false;
  return Boolean(item.assignedSdrId || item.assignedCampaignId);
}
