import { UploadWorkspace } from "@/components/v2/uploads/UploadWorkspace";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { ContextBar } from "@/components/v2/shell/ContextBar";
import { ImportNav } from "@/components/v2/shell/WorkspaceClusterNav";
import { getLeadContextOptions } from "@/lib/v2/crm";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type UploadsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

import { queryUploadsDashboard } from "@/lib/v2/ingestion/queryUploadsDashboard";

export default async function V2UploadsPage({ searchParams }: UploadsPageProps) {
  const rawParams = await searchParams;
  const tenantContext = await getUploadTenantContext();

  if (tenantContext instanceof V2TenantError) {
    const message = getTenantErrorMessage(tenantContext);

    return (
      <WorkspaceFrame className="flex items-center justify-center">
        <div className="max-w-xl rounded-lg border border-border bg-white p-6 text-center">
          <div className="text-sm font-semibold text-foreground">{message.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
          <p className="mt-3 text-xs text-muted-foreground">Code: {message.technicalCode}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const contextOptions = await getLeadContextOptions({
    organizationId: tenantContext.organizationId,
  });

  const dashboardData = await queryUploadsDashboard(tenantContext.organizationId);

  return (
    <>
      <div className="-mx-4 -mt-5 mb-5 sm:-mx-6 lg:-mx-8">
        <ContextBar
          options={contextOptions}
          organizationName={tenantContext.organizationName}
        />
      </div>
      <div className="mb-5"><ImportNav /></div>
      <UploadWorkspace
        context={{
          clientAccountId: getParam(rawParams, "clientAccountId"),
          projectId: getParam(rawParams, "projectId"),
          offerId: getParam(rawParams, "offerId"),
          icpVersionId: getParam(rawParams, "icpVersionId"),
        }}
        dashboardData={dashboardData}
      />
    </>
  );
}

async function getUploadTenantContext() {
  try {
    return await requirePermission("ingestion.apply");
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
