import Link from "next/link";
import { revalidatePath } from "next/cache";
import { MessagesSquare, GraduationCap, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { MetricCard } from "@/components/shared/MetricCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { WorkspaceMetricGrid } from "@/components/shared/WorkspaceMetricGrid";
import { FeedbackForm } from "@/components/v2/feedback/FeedbackForm";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { prisma } from "@/lib/server/prisma";
import {
  queryFeedbackLog,
  setFeedbackApprovedForLearning,
  type SetApprovedForLearningDb,
} from "@/lib/v2/feedback";
import {
  getTenantErrorMessage,
  hasPermission,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type FeedbackPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// M4: manager-gated approval of a captured feedback example into the learning set.
// Gated on feedback.approve; writes an audit event and never mutates the assessment.
async function setLearningAction(formData: FormData) {
  "use server";
  let context;
  try {
    context = await requirePermission("feedback.approve");
  } catch {
    return;
  }
  const feedbackExampleId = (formData.get("feedbackExampleId")?.toString() ?? "").trim();
  const approved = formData.get("approved")?.toString() === "true";
  const splitRaw = (formData.get("datasetSplit")?.toString() ?? "").trim();
  if (!feedbackExampleId) return;

  await setFeedbackApprovedForLearning(prisma as unknown as SetApprovedForLearningDb, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    feedbackExampleId,
    approved,
    datasetSplit: splitRaw === "EVAL" || splitRaw === "HOLDOUT" || splitRaw === "TRAIN" ? splitRaw : undefined,
  });
  revalidatePath("/v2/feedback");
}

export default async function V2FeedbackPage({ searchParams }: FeedbackPageProps) {
  const rawParams = await searchParams;
  const tenantContext = await getFeedbackTenantContext();

  if (tenantContext instanceof V2TenantError) {
    const msg = getTenantErrorMessage(tenantContext);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-xl border border-hairline bg-surface p-6 shadow-premium">
          <div className="text-sm font-bold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const leadAssignmentId = getParam(rawParams, "leadAssignmentId");
  const canApprove = hasPermission(tenantContext.role, "feedback.approve");
  const log = await queryFeedbackLog({
    organizationId: tenantContext.organizationId,
    leadAssignmentId,
    limit: 50,
  });

  const feedbackColumns: DataTableColumn<typeof log.rows[number]>[] = [
    {
      key: "lead",
      header: "Lead",
      cell: (row) => (
        <Link
          href={`/v2/workspace/leads?selectedLeadId=${row.leadAssignmentId}`}
          className="font-semibold text-foreground hover:text-primary transition-colors"
        >
          {row.companyName ?? (
            <span className="font-mono text-xs text-muted-foreground">
              {row.leadAssignmentId.slice(0, 10)}&hellip;
            </span>
          )}
        </Link>
      ),
    },
    {
      key: "icp",
      header: "ICP",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.icpProfileName ?? "ICP"}
          {row.icpVersionNumber !== null ? ` v${row.icpVersionNumber}` : ""}
        </span>
      ),
    },
    {
      key: "predicted_final",
      header: "Predicted \u2192 Final",
      cell: (row) => (
        <span>
          <span className="text-xs text-muted-foreground">
            {formatLabel(row.predictedQualification ?? "NOT_SCORED")}
          </span>
          <span className="mx-1 text-muted-foreground/60">&rarr;</span>
          <span className="font-semibold text-foreground">
            {formatLabel(row.finalQualification)}
          </span>
        </span>
      ),
    },
    {
      key: "fit",
      header: "Fit",
      cell: (row) => (
        <span className="text-xs text-foreground/80">
          {row.predictedFitScore ?? "\u2014"}
          <span className="mx-1 text-muted-foreground/60">&rarr;</span>
          {row.finalFitScore ?? "\u2014"}
        </span>
      ),
    },
    {
      key: "reviewer",
      header: "Reviewer",
      cell: (row) => <span className="text-xs text-muted-foreground">{row.reviewerEmail ?? "\u2014"}</span>,
    },
    {
      key: "learning",
      header: "Learning",
      cell: (row) => {
        if (canApprove) {
          if (row.approvedForLearning) {
            return (
              <form action={setLearningAction} className="flex items-center gap-1.5">
                <input type="hidden" name="feedbackExampleId" value={row.id} />
                <input type="hidden" name="approved" value="false" />
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-600">
                  {row.datasetSplit}
                </span>
                <button type="submit" className="cursor-pointer text-xs text-muted-foreground hover:text-red-500 transition-colors">
                  Revoke
                </button>
              </form>
            );
          } else {
            return (
              <form action={setLearningAction} className="flex items-center gap-1.5">
                <input type="hidden" name="feedbackExampleId" value={row.id} />
                <input type="hidden" name="approved" value="true" />
                <select name="datasetSplit" defaultValue="TRAIN" className="h-7 rounded-lg border border-hairline bg-surface px-2 text-xs text-foreground outline-none">
                  <option value="TRAIN">Train</option>
                  <option value="EVAL">Eval</option>
                  <option value="HOLDOUT">Holdout</option>
                </select>
                <button type="submit" className="cursor-pointer rounded-lg bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground hover:bg-primary/80 transition-colors shadow-sm">
                  Approve
                </button>
              </form>
            );
          }
        }
        if (row.approvedForLearning) {
          return (
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-600">
              {row.datasetSplit}
            </span>
          );
        }
        return <span className="text-xs text-muted-foreground font-semibold">pending</span>;
      },
    },
    {
      key: "when",
      header: "When",
      cell: (row) => <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</span>,
    },
  ];

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title="Feedback"
        description="Human-corrected scoring examples (Link C). Immutable assessment snapshots; never mutates ICP rules. Manager-approved examples feed ICP tuning."
      />

      <div className="grid gap-5 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 space-y-5">
          <WorkspaceMetricGrid>
            <MetricCard label="Feedback examples" value={log.stats.total.toLocaleString()} icon={MessagesSquare} />
            <MetricCard label="Approved for learning" value={log.stats.approvedForLearning.toLocaleString()} icon={GraduationCap} description="Manager-gated" />
            <MetricCard label="Distinct leads" value={log.stats.distinctLeads.toLocaleString()} icon={Users} />
          </WorkspaceMetricGrid>

          <PanelCard title="Feedback examples" contentClassName="p-0">
            <DataTable
              columns={feedbackColumns}
              rows={log.rows}
              getRowId={(row) => row.id}
              empty={
                <div className="px-4 py-10 text-center text-sm text-muted-foreground font-semibold">
                  No feedback captured yet
                  {leadAssignmentId ? " for this lead" : ""}. Use the form to record a
                  corrected qualification against the current assessment.
                </div>
              }
              className="border-none shadow-none rounded-none"
            />
          </PanelCard>
        </section>

        <aside>
          <FeedbackForm leadAssignmentId={leadAssignmentId} />
        </aside>
      </div>
    </WorkspaceFrame>
  );
}

async function getFeedbackTenantContext() {
  try {
    return await requirePermission("feedback.write");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }

    throw error;
  }
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;

  return first && first.trim() ? first.trim() : undefined;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}
