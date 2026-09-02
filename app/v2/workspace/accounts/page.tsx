import { requireTenantContext } from "@/lib/v2/tenant/requireTenantContext";
import { queryAccountWorkspace } from "@/lib/v2/product-tree/queryProductTree";
import { AccountWorkspaceClient } from "@/components/v2/accounts/AccountWorkspaceClient";
import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import type { AccountWorkspaceView } from "@/lib/v2/product-tree/types";

export const metadata = {
  title: "Accounts - Leadger",
};

const VIEWS = new Set<AccountWorkspaceView["view"]>([
  "overview",
  "projects",
  "offers",
  "icps",
  "companies",
  "contacts",
  "leads",
  "activity",
]);

const DRAWERS = new Set<NonNullable<AccountWorkspaceView["selectedContext"]["drawer"]>>([
  "account",
  "project",
  "offer",
  "icp",
  "company",
  "contact",
  "lead",
]);

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const context = await requireTenantContext();
  const params = await searchParams;
  const viewParam = pick(params, "view");
  const drawerParam = pick(params, "drawer");
  const workspace = await queryAccountWorkspace({
    organizationId: context.organizationId,
    accountId: pick(params, "accountId"),
    projectId: pick(params, "projectId"),
    offerId: pick(params, "offerId") ?? pick(params, "productId"),
    icpVersionId: pick(params, "icpVersionId"),
    search: pick(params, "search"),
    view: viewParam && VIEWS.has(viewParam as AccountWorkspaceView["view"]) ? (viewParam as AccountWorkspaceView["view"]) : "overview",
    drawer:
      drawerParam && DRAWERS.has(drawerParam as NonNullable<AccountWorkspaceView["selectedContext"]["drawer"]>)
        ? (drawerParam as NonNullable<AccountWorkspaceView["selectedContext"]["drawer"]>)
        : null,
  });
  const safeWorkspace = JSON.parse(JSON.stringify(workspace)) as AccountWorkspaceView;
  const create = pick(params, "create");

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title="Account health cockpit"
        description="Account -> Project -> Offer -> ICP workspace for running work, readiness, and lead health."
      />
      <div className="p-4 sm:p-5 lg:p-6">
        <AccountWorkspaceClient
          workspace={safeWorkspace}
          createMode={create === "project" || create === "account" ? create : null}
        />
      </div>
    </WorkspaceFrame>
  );
}

function pick(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : undefined;
}
