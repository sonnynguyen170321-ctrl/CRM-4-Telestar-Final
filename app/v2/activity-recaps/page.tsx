import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { ContextBar } from "@/components/v2/shell/ContextBar";
import { ActivityRecapWizard } from "@/components/v2/activity-recaps/ActivityRecapWizard";
import { getLeadContextOptions } from "@/lib/v2/crm";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type ActivityRecapsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function V2ActivityRecapsPage({ searchParams }: ActivityRecapsPageProps) {
  const rawParams = await searchParams;
  const tenantContext = await getActivityRecapsTenantContext();

  if (tenantContext instanceof V2TenantError) {
    const message = getTenantErrorMessage(tenantContext);
    return (
      <WorkspaceFrame className="flex items-center justify-center">
        <div className="max-w-xl rounded-xl border border-hairline bg-surface p-6 text-center shadow-premium">
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

  return (
    <>
      <div className="-mx-4 -mt-5 mb-5 sm:-mx-6 lg:-mx-8">
        <ContextBar options={contextOptions} organizationName={tenantContext.organizationName} />
      </div>
      <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
        <PageHeader
          eyebrow="Operate"
          title="Activity Recaps"
          description="Upload SDR activity recaps. The pipeline maps each row to a company, contact, lead assignment, project, and ICP, then records activities and routes flagged rows to the review queue."
        />
        <main className="space-y-5 px-6 py-5">
          <ActivityRecapWizard
            context={{
              clientAccountId: getParam(rawParams, "clientAccountId"),
              projectId: getParam(rawParams, "projectId"),
              icpVersionId: getParam(rawParams, "icpVersionId"),
            }}
          />
        </main>
      </WorkspaceFrame>
    </>
  );
}

async function getActivityRecapsTenantContext() {
  try {
    return await requirePermission("ingestion.apply");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return error;
    }
    throw error;
  }
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}
