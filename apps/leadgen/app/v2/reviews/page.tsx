import { ReviewQueueWorkspace } from "@/components/v2/reviews/ReviewQueueWorkspace";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { ActionableError } from "@/components/shared/ActionableError";
import { queryReviewQueue } from "@/lib/v2/manager-review";
import { getLeadWorkspaceDetail } from "@/lib/v2/crm";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type ReviewsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function V2ReviewsPage({ searchParams }: ReviewsPageProps) {
  const rawParams = await searchParams;
  const tenantContext = await getReviewsTenantContext();

  if (tenantContext instanceof V2TenantError) {
    return <TenantDeniedState error={tenantContext} />;
  }

  const selectedReviewId = getParam(rawParams, "reviewItemId");
  const sourceFilter = getParam(rawParams, "source");
  const priorityFilter = getParam(rawParams, "priority");
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(24, 0, 0, 0);
  const result = await queryReviewQueue({
    organizationId: tenantContext.organizationId,
    page: 1,
    pageSize: 50,
    filters: {
      includeDeleted: false,
    },
  });

  // M3: surface the SDR-grade lead context for the selected review. The reviewer
  // sees the same assessment/evidence the SDR sees, not a thin stub.
  const selectedLeadAssignmentId = selectedReviewId
    ? result.rows.find((row) => row.item.id === selectedReviewId)?.context.leadAssignment?.id ?? null
    : null;
  const selectedLeadDetail = selectedLeadAssignmentId
    ? await getLeadWorkspaceDetail({
        organizationId: tenantContext.organizationId,
        leadAssignmentId: selectedLeadAssignmentId,
      })
    : null;

  return (
    <ReviewQueueWorkspace
      result={result}
      selectedReviewId={selectedReviewId}
      selectedLeadDetail={selectedLeadDetail}
      sourceFilter={sourceFilter}
      priorityFilter={priorityFilter}
      nowMs={now.getTime()}
      endOfTodayMs={endOfToday.getTime()}
    />
  );
}

async function getReviewsTenantContext() {
  try {
    return await requirePermission("manager_review.decide");
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
      <ActionableError
        title={message.title}
        reason={message.message}
        actionLabel={message.actionLabel}
        actionHref={message.actionHref}
        technicalCode={message.technicalCode}
      />
    </WorkspaceFrame>
  );
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;

  return first && first.trim() ? first.trim() : undefined;
}
