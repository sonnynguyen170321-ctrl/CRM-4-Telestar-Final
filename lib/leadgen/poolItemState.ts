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
}

/** Routed to a campaign or rep, but no `Lead` exists yet — the rep cannot see it. */
export function isAwaitingConversion(item: PoolRoutingFields): boolean {
  if (item.convertedLeadId) return false;
  return Boolean(item.assignedSdrId || item.assignedCampaignId);
}
