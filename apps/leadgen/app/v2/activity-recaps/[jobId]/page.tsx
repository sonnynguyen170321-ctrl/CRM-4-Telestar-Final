import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { ProgressPanel } from "@/components/v2/ingestion/ProgressPanel";
import { ManagerReviewFlags } from "@/components/v2/activity-recaps/ManagerReviewFlags";
import { RecapSummaryBySdr } from "@/components/v2/activity-recaps/RecapSummaryBySdr";
import { StandardizedActivityTable } from "@/components/v2/activity-recaps/StandardizedActivityTable";
import { prisma } from "@/lib/server/prisma";
import {
  queryRecapSummary,
  queryStandardizedRows,
} from "@/lib/v2/activity-recaps/queryRecapSummary";
import { queryReviewFlags } from "@/lib/v2/activity-recaps/queryReviewFlags";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type DetailPageProps = {
  params: Promise<{ jobId: string }>;
};

type IngestionJobHeader = {
  id: string;
  status: string;
  jobType: string;
  originalFileName: string;
  createdAt: Date;
  updatedAt: Date;
};

export default async function V2ActivityRecapDetailPage({ params }: DetailPageProps) {
  const { jobId } = await params;
  const tenantContext = await getTenantContext();

  if (tenantContext instanceof V2TenantError) {
    const message = getTenantErrorMessage(tenantContext);
    return (
      <WorkspaceFrame className="flex items-center justify-center">
        <div className="max-w-xl rounded-xl border border-hairline bg-surface p-6 text-center shadow-premium">
          <div className="text-sm font-semibold text-foreground">{message.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const job = await loadJob(tenantContext.organizationId, jobId);

  if (!job) {
    return (
      <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
        <PageHeader eyebrow="Operate" title="Activity recap not found" />
        <main className="px-6 py-5">
          <div className="rounded-xl border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted-foreground shadow-premium">
            No activity recap exists for this tenant and id.
            <div className="mt-3">
              <Link href="/v2/activity-recaps" className="font-semibold text-primary hover:underline">
                Back to upload
              </Link>
            </div>
          </div>
        </main>
      </WorkspaceFrame>
    );
  }

  const [summary, reviewFlags, rows] = await Promise.all([
    queryRecapSummary(tenantContext.organizationId, jobId),
    queryReviewFlags(tenantContext.organizationId, jobId),
    queryStandardizedRows(tenantContext.organizationId, jobId, { limit: 300 }),
  ]);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Operate"
        title="Activity recap"
        description={job.originalFileName}
      />
      <main className="space-y-5 px-6 py-5">
        <div>
          <Link
            href="/v2/activity-recaps"
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Upload another recap
          </Link>
        </div>

        <ProgressPanel ingestionJobId={jobId} />

        <RecapSummaryBySdr summary={summary} />

        <ManagerReviewFlags counts={reviewFlags} />

        <StandardizedActivityTable jobId={jobId} rows={rows} />
      </main>
    </WorkspaceFrame>
  );
}

async function getTenantContext() {
  try {
    return await requirePermission("ingestion.apply");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }
    throw error;
  }
}

async function loadJob(organizationId: string, jobId: string) {
  const rows = await prisma.$queryRaw<IngestionJobHeader[]>`
    SELECT "id", "status"::text AS "status", "jobType"::text AS "jobType",
           "originalFileName", "createdAt", "updatedAt"
    FROM "V2IngestionJob"
    WHERE "organizationId" = ${organizationId}
      AND "id" = ${jobId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
