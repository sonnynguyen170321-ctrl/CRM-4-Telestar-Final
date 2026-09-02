"use client";

import * as React from "react";
import Link from "next/link";
import { PlusIcon, FolderIcon, Building2Icon } from "lucide-react";

import { PaginatedResult, ProjectListRow, AccountListRow } from "@/lib/v2/product-tree/types";
import { createProjectAction } from "@/app/v2/workspace/projects/actions";

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

export function ProjectListClient({
  result,
  accounts,
  defaultAccountId,
  defaultCreateOpen = false,
}: {
  result: PaginatedResult<ProjectListRow>;
  accounts: AccountListRow[];
  defaultAccountId?: string;
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
    const res = await createProjectAction(formData);

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
        <h2 className="text-lg font-medium">All Projects ({pagination.total})</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={accounts.length === 0}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Create Project
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={onSubmit}>
              <DialogHeader>
                <DialogTitle>Create Project</DialogTitle>
                <DialogDescription>
                  Add a new project to an existing client account.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {error && (
                  <div className="text-sm font-medium text-destructive">
                    {error}
                  </div>
                )}
                <div className="grid gap-2">
                  <label htmlFor="clientAccountId" className="text-sm font-medium">
                    Client Account
                  </label>
                  <Select name="clientAccountId" defaultValue={defaultAccountId || (accounts.length === 1 ? accounts[0].id : undefined)} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="name" className="text-sm font-medium">
                    Project Name
                  </label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Q3 APAC Expansion"
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
                    placeholder="Brief details about this project..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Project"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title="No client accounts"
          description="You need to create a client account before you can create projects."
          action={
            <Button asChild>
              <Link href="/v2/workspace/accounts?create=account">Go to Accounts</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title="No projects found"
          description="Get started by creating your first project."
          action={
            <Button onClick={() => setIsCreateOpen(true)}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Create Project
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((project) => (
            <Link
              key={project.id}
              href={`/v2/workspace/accounts?view=projects&accountId=${project.accountId}&projectId=${project.id}`}
              className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold line-clamp-1">{project.name}</h3>
                  <div className="flex items-center text-xs text-muted-foreground mt-1">
                    <Building2Icon className="mr-1 h-3 w-3" />
                    <span className="line-clamp-1">{project.accountName}</span>
                  </div>
                </div>
                <FolderIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              {project.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  {project.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{project.offerCount}</span>
                  <span>Offers</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{project.icpVersionCount}</span>
                  <span>ICPs</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{project.leadAssignmentCount}</span>
                  <span>Leads</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
