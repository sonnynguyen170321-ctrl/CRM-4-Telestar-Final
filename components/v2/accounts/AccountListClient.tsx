"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PlusIcon, Building2Icon, FolderIcon, LayoutDashboardIcon, UsersIcon, SearchIcon, FilterIcon, CalendarIcon, LayoutListIcon, AlignJustifyIcon } from "lucide-react";

import { PaginatedResult, AccountListRow, ProductTreeOverview, AccountDetail } from "@/lib/v2/product-tree/types";
import { createAccountAction } from "@/app/v2/workspace/accounts/actions";

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
import { WorkspaceMetricGrid } from "@/components/shared/WorkspaceMetricGrid";
import { MetricCard } from "@/components/shared/MetricCard";
import { AccountDetailDrawer } from "./AccountDetailDrawer";
import { V2FilterPanel } from "@/components/shared/V2FilterPanel";
import { DataTable, type DataTableColumn, DataTablePagination } from "@/components/shared/DataTable";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AccountListClient({
  result,
  overview,
  selectedAccountDetail,
}: {
  result: PaginatedResult<AccountListRow>;
  overview: ProductTreeOverview;
  selectedAccountDetail: AccountDetail | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const { rows, pagination } = result;

  const buildPageHref = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    return `?${params.toString()}`;
  };

  const paginationFooter = (
    <DataTablePagination
      page={pagination.page}
      totalPages={pagination.totalPages}
      label={`${pagination.total} accounts`}
      previousHref={buildPageHref(Math.max(1, pagination.page - 1))}
      nextHref={buildPageHref(Math.min(pagination.totalPages, pagination.page + 1))}
    />
  );

  const columns: DataTableColumn<AccountListRow>[] = [
    {
      key: "account",
      header: "Account",
      cell: (account) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background shrink-0">
            <Building2Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-foreground truncate">{account.name}</span>
            <span className="text-xs text-muted-foreground truncate">
              {account.name.toLowerCase().replace(/\s+/g, "")}.com
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (account) => (
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
          <span className="truncate">{account.ownerName}</span>
        </div>
      ),
    },
    {
      key: "region",
      header: "Region",
      cell: (account) => <span className="text-muted-foreground">{account.region}</span>,
    },
    {
      key: "industry",
      header: "Industry",
      cell: (account) => <span className="text-muted-foreground">{account.industry}</span>,
    },
    {
      key: "activeProjects",
      header: "Active Projects",
      cell: (account) => <span className="font-medium text-primary">{account.projectCount}</span>,
    },
    {
      key: "offers",
      header: "Products / Offers",
      cell: (account) => <span className="font-medium text-orange-600">{account.offerCount}</span>,
    },
    {
      key: "icps",
      header: "Published ICPs",
      cell: (account) => <span className="font-medium text-foreground">{account.icpVersionCount}</span>,
    },
  ];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await createAccountAction(formData);

    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      setIsCreateOpen(false);
    }
  }

  // Handle clicking a row
  const handleRowClick = (accountId: string) => {
    // preserve other search params if any
    const params = new URLSearchParams(searchParams.toString());
    params.set("accountId", accountId);
    router.push(`?${params.toString()}`);
  };

  const currentRegion = searchParams.get("region") || "all";
  const currentOwner = searchParams.get("ownerId") || "all";
  const currentIndustry = searchParams.get("industry") || "all";

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    // Reset page to 1 on filter change
    params.delete("page");
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* Top Metrics Row */}
      <WorkspaceMetricGrid className="xl:grid-cols-6">
        <MetricCard
          label="Total Accounts"
          value={overview.accountsCount}
          icon={Building2Icon}
          trend={<span className="text-green-600">↑ 8% vs last 30 days</span>}
        />
        <MetricCard
          label="Active Projects"
          value={overview.projectsCount}
          icon={FolderIcon}
          trend={<span className="text-green-600">↑ 15% vs last 30 days</span>}
        />
        <MetricCard
          label="Published ICPs"
          value={overview.icpVersionsCount}
          icon={UsersIcon}
          trend={<span className="text-green-600">↑ 12% vs last 30 days</span>}
        />
        <MetricCard
          label="Open Leads"
          value="612" // Mocked to match UI until organization-level leads rollup exists
          icon={LayoutListIcon}
          trend={<span className="text-green-600">↑ 10% vs last 30 days</span>}
        />
        <MetricCard
          label="Meetings"
          value="27" // Mocked to match UI
          icon={CalendarIcon}
          trend={<span className="text-green-600">↑ 22% vs last 30 days</span>}
        />
        <MetricCard
          label="Manager Reviews"
          value="18" // Mocked to match UI
          icon={AlignJustifyIcon}
          trend={<span className="text-green-600">↑ 18% vs last 30 days</span>}
        />
      </WorkspaceMetricGrid>

      {/* Main Content Layout (Sidebar + Table) */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        
        {/* Left Filter Sidebar */}
        <div className="w-full lg:w-64 shrink-0 flex flex-col gap-4">
          <V2FilterPanel 
            title="Filters" 
            actions={
              <Button variant="link" size="sm" className="h-auto p-0 text-primary" onClick={() => router.push(pathname)}>
                Clear all
              </Button>
            }
          >
            <div className="space-y-4 text-sm">
              <div className="space-y-1.5">
                <label className="font-medium">Region</label>
                <Select value={currentRegion} onValueChange={(v) => handleFilterChange("region", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All Regions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Regions</SelectItem>
                    <SelectItem value="NA">North America</SelectItem>
                    <SelectItem value="EMEA">EMEA</SelectItem>
                    <SelectItem value="APAC">APAC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="font-medium">Owner</label>
                <Select value={currentOwner} onValueChange={(v) => handleFilterChange("ownerId", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All Owners" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Owners</SelectItem>
                    {/* Ideally fetch actual owners. Mocking common IDs or strings for now */}
                    <SelectItem value="alex_id">Alex Rivera</SelectItem>
                    <SelectItem value="jordan_id">Jordan Lee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="font-medium">Industry</label>
                <Select value={currentIndustry} onValueChange={(v) => handleFilterChange("industry", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All Industries" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Industries</SelectItem>
                    <SelectItem value="Technology">Technology</SelectItem>
                    <SelectItem value="Finance">Finance</SelectItem>
                    <SelectItem value="Healthcare">Healthcare</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </V2FilterPanel>
          
          <V2FilterPanel title="Saved views">
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1 rounded">
                <LayoutDashboardIcon className="h-4 w-4 text-muted-foreground" />
                <span>My Accounts</span>
              </div>
              <div className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1 rounded">
                <Building2Icon className="h-4 w-4 text-muted-foreground" />
                <span>High Priority Accounts</span>
              </div>
              <div className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1 rounded">
                <Building2Icon className="h-4 w-4 text-muted-foreground" />
                <span>At Risk Accounts</span>
              </div>
              <Button variant="link" className="justify-start px-0 mt-2 h-auto">
                + Save current view
              </Button>
            </div>
          </V2FilterPanel>
        </div>

        {/* Center Table Area */}
        <div className="flex-1 w-full min-w-0 flex flex-col gap-4">
          
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="font-semibold">{pagination.total} Accounts</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative w-64">
                <SearchIcon className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search accounts..." className="pl-9 h-9" />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                <span>Group by: None</span>
              </div>
              <Button variant="outline" size="sm" className="gap-2">
                <FilterIcon className="h-4 w-4" />
                Columns
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-primary hover:bg-primary text-white">
                    <PlusIcon className="mr-2 h-4 w-4" />
                    Add Account
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <form onSubmit={onSubmit}>
                    <DialogHeader>
                      <DialogTitle>Create Client Account</DialogTitle>
                      <DialogDescription>
                        Add a new client account to organize projects and offers.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      {error && (
                        <div className="text-sm font-medium text-destructive">
                          {error}
                        </div>
                      )}
                      <div className="grid gap-2">
                        <label htmlFor="name" className="text-sm font-medium">
                          Account Name
                        </label>
                        <Input
                          id="name"
                          name="name"
                          placeholder="Acme Corp"
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
                          placeholder="Brief details about this account..."
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Creating..." : "Create Account"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div
            className="rounded-md border bg-card overflow-hidden"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest("button, a, input, select")) return;
              const tr = target.closest("tr[data-row-id]");
              if (tr) {
                const id = tr.getAttribute("data-row-id");
                if (id) handleRowClick(id);
              }
            }}
          >
            {rows.length === 0 ? (
              <EmptyState
                icon={Building2Icon}
                title="No client accounts"
                description="Get started by creating your first client account."
                action={
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    Create Account
                  </Button>
                }
              />
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                getRowId={(account) => account.id}
                selectedId={selectedAccountDetail?.id}
                footer={paginationFooter}
                minWidth="w-full text-sm text-left"
                className="border-none shadow-none rounded-none bg-transparent"
              />
            )}
          </div>

        </div>
      </div>

      {/* Account Detail Drawer */}
      <AccountDetailDrawer account={selectedAccountDetail} />

    </div>
  );
}
