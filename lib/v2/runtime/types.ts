// Phase R (R1): runtime mirror types. Pure — no DB/Redis import, safe for UI.

export type RuntimeStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL" | "CANCELLED";

export type RuntimeRun = {
  id: string;
  organizationId: string;
  projectId: string | null;
  icpVersionId: string | null;
  runType: string;
  status: RuntimeStatus;
  totalUnits: number;
  processedUnits: number;
  succeededUnits: number;
  failedUnits: number;
  skippedUnits: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type RuntimeChunkInput = {
  chunkIndex: number;
  dedupeKey: string;
  unitCount: number;
  cursorStart?: string | null;
  cursorEnd?: string | null;
};

export type RuntimeRunStatusView = {
  run: RuntimeRun;
  chunks: { total: number; queued: number; running: number; succeeded: number; failed: number };
  progressPercent: number;
};

/** Roll a run + its chunk counts up into a single terminal/partial status. */
export function rollupRunStatus(c: { total: number; succeeded: number; failed: number; running: number; queued: number }): RuntimeStatus {
  if (c.total === 0) return "QUEUED";
  const done = c.succeeded + c.failed;
  if (done < c.total) return c.running > 0 || c.succeeded > 0 || c.failed > 0 ? "RUNNING" : "QUEUED";
  if (c.failed === 0) return "SUCCEEDED";
  if (c.succeeded === 0) return "FAILED";
  return "PARTIAL";
}
