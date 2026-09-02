import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { prisma } from "@/lib/server/prisma";
import { createScoringRun } from "@/lib/v2/scoring/runtime/createScoringRun";
import { enqueueScoringExecution } from "@/lib/v2/scoring/runtime/enqueueScoringExecution";
import type { V2ScoreRuntimeDatabase } from "@/lib/v2/scoring/runtime/types";
import { requirePermission, V2TenantError, getTenantErrorMessage } from "@/lib/v2/tenant";

type RescoreViewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function rescoreAction(formData: FormData) {
  "use server";
  
  const tenant = await requirePermission("workflow.update");
  if (tenant instanceof V2TenantError) throw new Error("Unauthorized");
  
  const projectId = formData.get("projectId")?.toString();
  const icpVersionId = formData.get("icpVersionId")?.toString();
  
  if (!projectId || !icpVersionId) {
    throw new Error("Missing context");
  }
  
  const guard = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
      SELECT project."id"
      FROM "V2Project" project
      INNER JOIN "V2ICPVersion" icp
        ON icp."organizationId" = project."organizationId"
        AND icp."id" = $3
        AND icp."deletedAt" IS NULL
      WHERE project."id" = $1
        AND project."organizationId" = $2
        AND project."status" = 'ACTIVE'
      LIMIT 1
    `,
    projectId,
    tenant.organizationId,
    icpVersionId
  );

  if (!guard[0]) {
    throw new Error("Project or ICP version not found");
  }

  const db = prisma as unknown as V2ScoreRuntimeDatabase;

  // R2: plan a runtime run (freezes the selection + creates the chunk mirror), then
  // enqueue the matching ICP_SCORE job. No inline drain — the worker (or db drain
  // route) processes it async and the handler mirrors progress onto the run, which the
  // status page polls.
  const run = await createScoringRun(db, {
    organizationId: tenant.organizationId,
    selection: { kind: "project_icp", projectId, icpVersionId },
    projectId,
    icpVersionId,
    createdByUserId: tenant.userId,
  });

  // Dispatch execution: BullMQ chunk fan-out when enabled, else the ICP_SCORE ledger.
  await enqueueScoringExecution(db, {
    organizationId: tenant.organizationId,
    run,
    createdByUserId: tenant.userId,
  });

  redirect(`/v2/workspace/leads/score-run?runId=${run.runId}&projectId=${projectId}&icpVersionId=${icpVersionId}`);
}

export default async function RescoreViewPage({ searchParams }: RescoreViewPageProps) {
  const params = await searchParams;
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const icpVersionId = Array.isArray(params.icpVersionId) ? params.icpVersionId[0] : params.icpVersionId;

  const tenantContext = await getLeadWorkspaceTenantContext();

  if (tenantContext instanceof V2TenantError) {
    return <TenantDeniedState error={tenantContext} />;
  }

  if (!projectId || !icpVersionId) {
    return (
      <WorkspaceFrame>
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50 p-8 text-center">
          <div className="text-sm font-semibold text-red-900">Missing Context</div>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-red-700">
            A Project and ICP Version must be selected to run scoring.
          </p>
          <Link href="/v2/workspace/leads" className="mt-4 inline-block text-sm text-primary hover:underline">
            Return to Leads Workspace
          </Link>
        </div>
      </WorkspaceFrame>
    );
  }

  return (
    <WorkspaceFrame>
      <PageHeader
        eyebrow="Leadger"
        title="Run Scoring Pipeline"
        description="Trigger ICP scoring for the current Project and ICP context."
      />
      <main className="mt-6">
        <div className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Confirm Scoring Run</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You are about to enqueue scoring jobs for all unscored lead assignments in the current project. 
            Identical scores will be reused idempotently.
          </p>
          <div className="mt-4 rounded bg-muted/40 p-3 text-xs text-muted-foreground font-mono">
            Project ID: {projectId} <br />
            ICP Version ID: {icpVersionId}
          </div>
          
          <form action={rescoreAction} className="mt-8 flex items-center justify-between">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="icpVersionId" value={icpVersionId} />
            
            <Link 
              href={`/v2/workspace/leads?projectId=${projectId}&icpVersionId=${icpVersionId}`} 
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" /> Cancel
            </Link>
            
            <button 
              type="submit" 
              className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2"
            >
              Run Scoring
            </button>
          </form>
        </div>
      </main>
    </WorkspaceFrame>
  );
}

async function getLeadWorkspaceTenantContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }
    throw error;
  }
}

function TenantDeniedState({ error }: { error: V2TenantError }) {
  const message = getTenantErrorMessage(error);
  return (
    <WorkspaceFrame className="flex items-center justify-center">
      <div className="max-w-xl rounded-lg border border-border bg-white p-6 text-center">
        <div className="text-sm font-semibold text-foreground">{message.title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
        <p className="mt-3 text-xs text-muted-foreground">Code: {message.technicalCode}</p>
        {message.actionHref && message.actionLabel && (
          <a
            href={message.actionHref}
            className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary"
          >
            {message.actionLabel}
          </a>
        )}
      </div>
    </WorkspaceFrame>
  );
}
