"use client";

import * as React from "react";
import Link from "next/link";
import { PlusIcon, FileBoxIcon, FolderIcon, Building2Icon } from "lucide-react";

import { PaginatedResult, OfferListRow, ProjectListRow } from "@/lib/v2/product-tree/types";
import { createOfferAction } from "@/app/v2/offers/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function OfferListClient({
  result,
  projects,
  defaultProjectId,
  defaultCreateOpen = false,
}: {
  result: PaginatedResult<OfferListRow>;
  projects: ProjectListRow[];
  defaultProjectId?: string;
  defaultCreateOpen?: boolean;
}) {
  const [isCreateOpen, setIsCreateOpen] = React.useState(defaultCreateOpen);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const { rows, pagination } = result;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await createOfferAction(formData);

    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      setIsCreateOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">All Offers ({pagination.total})</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={projects.length === 0}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Create Offer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={onSubmit}>
              <DialogHeader>
                <DialogTitle>Create Offer</DialogTitle>
                <DialogDescription>
                  Add a new offer under an existing project.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {error && (
                  <div className="text-sm font-medium text-destructive">
                    {error}
                  </div>
                )}
                <div className="grid gap-2">
                  <label htmlFor="projectId" className="text-sm font-medium">
                    Project
                  </label>
                  <Select name="projectId" defaultValue={defaultProjectId || (projects.length === 1 ? projects[0].id : undefined)} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(proj => (
                        <SelectItem key={proj.id} value={proj.id}>
                          {proj.name} ({proj.accountName})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="name" className="text-sm font-medium">
                    Offer Name
                  </label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Premium Tier"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="description" className="text-sm font-medium">
                    Description (Optional)
                  </label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Brief details about this offer..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Offer"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title="No projects found"
          description="You need to create a project before you can create offers."
          action={
            <Button asChild>
              <Link href="/v2/workspace/accounts?view=projects">Go to Projects</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileBoxIcon}
          title="No offers found"
          description="Get started by creating your first offer."
          action={
            <Button onClick={() => setIsCreateOpen(true)}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Create Offer
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((offer) => (
            <Link
              key={offer.id}
              href={`/v2/offers/${offer.id}`}
              className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold line-clamp-1">{offer.name}</h3>
                  <div className="flex items-center text-xs text-muted-foreground mt-1 gap-2">
                    <span className="flex items-center">
                      <FolderIcon className="mr-1 h-3 w-3" />
                      <span className="line-clamp-1 max-w-[100px]">{offer.projectName}</span>
                    </span>
                    <span className="flex items-center">
                      <Building2Icon className="mr-1 h-3 w-3" />
                      <span className="line-clamp-1 max-w-[100px]">{offer.accountName}</span>
                    </span>
                  </div>
                </div>
                <FileBoxIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              {offer.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  {offer.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{offer.icpProfileCount}</span>
                  <span>ICP Profiles</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{offer.icpVersionCount}</span>
                  <span>ICP Versions</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
