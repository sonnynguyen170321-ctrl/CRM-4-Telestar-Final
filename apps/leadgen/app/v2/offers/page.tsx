import { requireTenantContext } from "@/lib/v2/tenant/requireTenantContext";
import { queryOffers, queryProjects } from "@/lib/v2/product-tree/queryProductTree";
import { OfferListClient } from "@/components/v2/offers/OfferListClient";
import { PageHeader } from "@/components/shared/PageHeader";

export const metadata = {
  title: "Offers - Leadger",
};

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const context = await requireTenantContext();
  const resolvedParams = await searchParams;
  
  const pageParam = resolvedParams.page;
  const page = typeof pageParam === "string" ? parseInt(pageParam, 10) : 1;
  
  const searchParam = resolvedParams.search;
  const search = typeof searchParam === "string" ? searchParam : undefined;

  const projectIdParam = resolvedParams.projectId;
  const projectId = typeof projectIdParam === "string" ? projectIdParam : undefined;

  const createParam = resolvedParams.create;
  const showCreateOpen = createParam === "true";

  const [result, projectsResult] = await Promise.all([
    queryOffers({
      organizationId: context.organizationId,
      projectId,
      page,
      search,
    }),
    // Fetch projects for the create form dropdown. Taking 100 for simplicity now.
    queryProjects({
      organizationId: context.organizationId,
      page: 1,
    }),
  ]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Offers"
        description="Manage your organization's offers."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <OfferListClient 
          result={result} 
          projects={projectsResult.rows} 
          defaultProjectId={projectId}
          defaultCreateOpen={showCreateOpen}
        />
      </div>
    </div>
  );
}
