import { IcpLibraryWorkspace } from "@/components/v2/icp-library/IcpLibraryWorkspace";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { queryIcpLibrary } from "@/lib/v2/icp";
import { queryOffers } from "@/lib/v2/product-tree/queryProductTree";
import {
  getTenantErrorMessage,
  requirePermission,
  V2TenantError,
} from "@/lib/v2/tenant";

type IcpLibraryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function V2IcpLibraryPage({
  searchParams,
}: IcpLibraryPageProps) {
  const rawParams = await searchParams;
  const tenantContext = await getIcpTenantContext();

  if (tenantContext instanceof V2TenantError) {
    return <TenantDeniedState error={tenantContext} />;
  }

  const [result, offersResult] = await Promise.all([
    queryIcpLibrary({
      organizationId: tenantContext.organizationId,
      selectedIcpVersionId: getParam(rawParams, "icpVersionId"),
    }),
    queryOffers({
      organizationId: tenantContext.organizationId,
      page: 1,
    })
  ]);

  const createParam = getParam(rawParams, "create");
  const defaultOfferId = getParam(rawParams, "offerId");

  return (
    <IcpLibraryWorkspace
      result={result}
      selectedIcpVersionId={getParam(rawParams, "icpVersionId")}
      offers={offersResult.rows}
      defaultOfferId={defaultOfferId}
      defaultCreateOpen={createParam === "true"}
    />
  );
}

async function getIcpTenantContext() {
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
        <div className="text-sm font-semibold text-foreground">
          {message.title}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{message.message}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          Code: {message.technicalCode}
        </p>
      </div>
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
