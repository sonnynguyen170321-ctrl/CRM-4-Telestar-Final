"use server";

import { redirect } from "next/navigation";

import { retryScoringRunFailures } from "@/lib/v2/scoring/runtime/retryScoringRun";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// P6: re-fan a scoring run's FAILED chunks. Tenant-scoped (the run is read/written under
// the caller's org). On success it redirects back to the same status page, which polls
// the mirror as the re-fanned chunks move QUEUED -> RUNNING -> SUCCEEDED.

function field(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

export async function retryScoringRunAction(formData: FormData) {
  const ctx = await requirePermission("workflow.update");
  if (ctx instanceof V2TenantError) throw new Error("Unauthorized");

  const runId = field(formData, "runId");
  if (!runId) throw new Error("Missing runId");

  await retryScoringRunFailures(ctx.organizationId, runId);

  const projectId = field(formData, "projectId");
  const icpVersionId = field(formData, "icpVersionId");
  const scope = projectId && icpVersionId ? `&projectId=${projectId}&icpVersionId=${icpVersionId}` : "";
  redirect(`/v2/workspace/leads/score-run?runId=${runId}${scope}`);
}
