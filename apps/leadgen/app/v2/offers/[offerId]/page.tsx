import { notFound } from "next/navigation";
import Link from "next/link";
import { PlusIcon, FileCode2Icon, ArrowRightIcon } from "lucide-react";

import { requireTenantContext } from "@/lib/v2/tenant/requireTenantContext";
import { getOfferDetail } from "@/lib/v2/product-tree/queryProductTree";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

export default async function OfferDetailPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const context = await requireTenantContext();
  const { offerId } = await params;

  const offer = await getOfferDetail({
    organizationId: context.organizationId,
    offerId,
  });

  if (!offer) {
    notFound();
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={offer.name}
        description={offer.description || `Offer in ${offer.project.name}`}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href={`/v2/icp-library?offerId=${offer.id}&create=true`}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Create ICP from preset
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/v2/icp-library?offerId=${offer.id}`}>
              View ICP Library
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-sm font-medium text-muted-foreground">Project</div>
            <div className="mt-1 text-xl font-semibold line-clamp-1">{offer.project.name}</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-sm font-medium text-muted-foreground">Account</div>
            <div className="mt-1 text-xl font-semibold line-clamp-1">{offer.project.clientAccount.name}</div>
          </div>
          <div className="rounded-xl border bg-card p-4 lg:col-span-2">
            <div className="text-sm font-medium text-muted-foreground">Quick Actions</div>
            <div className="mt-2 flex gap-4">
              <Link href={`/v2/ingestion/uploads?offerId=${offer.id}`} className="text-sm text-primary hover:underline">
                Upload with context
              </Link>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-medium mb-4">ICP Profiles</h2>
          {offer.icpProfiles.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              <FileCode2Icon className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>No ICP profiles created yet.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {offer.icpProfiles.map((profile) => (
                <Link
                  key={profile.id}
                  href={`/v2/icp-library?icpProfileId=${profile.id}`}
                  className="group flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold line-clamp-1">{profile.name}</h3>
                    <ArrowRightIcon className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  {profile.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {profile.description}
                    </p>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{profile.versions.length}</span> versions
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
