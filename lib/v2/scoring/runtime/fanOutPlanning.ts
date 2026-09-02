// S1 fan-out planning — pure (no I/O). The DB returns one row per (project,
// icpVersion) the company should be scored against; this dedupes + stably orders
// them so the fan-out ensures each LeadAssignment exactly once (Invariant 6: no
// duplicate leads/jobs from a re-run).

export type ProjectIcpPair = { projectId: string; icpVersionId: string };

export function dedupeProjectIcpPairs(pairs: ProjectIcpPair[]): ProjectIcpPair[] {
  const seen = new Set<string>();
  const out: ProjectIcpPair[] = [];
  for (const p of pairs) {
    const projectId = p.projectId?.trim();
    const icpVersionId = p.icpVersionId?.trim();
    if (!projectId || !icpVersionId) continue;
    const key = `${projectId}::${icpVersionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ projectId, icpVersionId });
  }
  out.sort((a, b) =>
    a.projectId === b.projectId
      ? a.icpVersionId.localeCompare(b.icpVersionId)
      : a.projectId.localeCompare(b.projectId)
  );
  return out;
}

export function distinctProjectCount(pairs: ProjectIcpPair[]): number {
  return new Set(pairs.map((p) => p.projectId)).size;
}
