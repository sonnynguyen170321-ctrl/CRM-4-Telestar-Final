// Pure prospect-ledger types + dedupe decision. No DB import, so it stays unit-testable offline
// and safe to import from client-adjacent code. The DB upsert/lookup live in prospectLedger.ts.

export type ProspectLedgerEntry = {
  dedupeFingerprint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  timesSeen: number;
  lastRunId: string | null;
};

/** A prospect counts as "seen before" only if a PRIOR run already recorded it (not this run's
 *  own earlier batch). Callers pass the pre-upsert ledger entry. */
export function wasSeenInPriorRun(entry: ProspectLedgerEntry | undefined, runId: string): boolean {
  return Boolean(entry && entry.lastRunId && entry.lastRunId !== runId);
}
