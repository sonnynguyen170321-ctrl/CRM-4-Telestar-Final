"use client";

import * as React from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { Building2Icon, ArrowRightIcon } from "lucide-react";
import { formatDate } from "@/lib/v2/format/datetime";
import Link from "next/link";

import { V2DetailDrawer, EntityHeader } from "@/components/v2/drawers/V2DetailDrawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/shared/Tabs";
import { AccountDetail } from "@/lib/v2/product-tree/types";

export function AccountDetailDrawer({
  account,
}: {
  account: AccountDetail | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Group lead assignments by company so the UI is cleaner and avoids repeating the
  // same company. Hook must run unconditionally (before any early return) to keep a
  // stable hook order - it is null-safe for the no-account case.
  const companyGroups = React.useMemo(() => {
    if (!account) return [];
    const allLeads = account.projects.flatMap(p => p.leadAssignments);
    const groups = new Map<string, {
      companyId: string;
      companyName: string;
      leads: typeof allLeads;
    }>();

    allLeads.forEach(lead => {
      const existing = groups.get(lead.companyId);
      if (existing) {
        existing.leads.push(lead);
      } else {
        groups.set(lead.companyId, {
          companyId: lead.companyId,
          companyName: lead.company.name,
          leads: [lead]
        });
      }
    });

    return Array.from(groups.values());
  }, [account]);

  if (!account) return null;

  // Keep all search params except accountId when closing
  const createCloseUrl = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("accountId");
    return `${pathname}?${params.toString()}`;
  };

  return (
    <V2DetailDrawer
      open={!!account}
      onClose={() => { window.location.href = createCloseUrl(); }}
      widthClass="lg:w-[640px]"
    >
      <EntityHeader
        eyebrow="Account"
        title={
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
              <Building2Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-semibold">{account.name}</span>
              {account.description && (
                <span className="text-sm font-normal text-muted-foreground line-clamp-1">{account.description}</span>
              )}
            </div>
          </div>
        }
        onClose={() => { window.location.href = createCloseUrl(); }}
      />
      <Tabs defaultValue="overview" className="w-full mt-2">
        <TabsList className="w-full justify-start border-b rounded-none bg-transparent h-auto p-0">
          <TabsTrigger value="overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="projects">
            Projects <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{account.projects.length}</span>
          </TabsTrigger>
          <TabsTrigger value="offers">
            Offers
          </TabsTrigger>
          <TabsTrigger value="icps">
            ICPs
          </TabsTrigger>
          <TabsTrigger value="leads">
            Leads / Companies
          </TabsTrigger>
          <TabsTrigger value="activity">
            Activity
          </TabsTrigger>
        </TabsList>

        <div className="pt-6">
          <TabsContent value="overview" className="m-0 focus-visible:outline-none">
            <div className="grid gap-6">
              <div className="rounded-xl border p-4 bg-card">
                <h3 className="font-medium text-sm text-muted-foreground mb-4">Pipeline Overview</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/50">
                    <span className="text-2xl font-semibold">{account.leadsTotal}</span>
                    <span className="text-xs text-muted-foreground">Total In Scope</span>
                  </div>
                  <div className="flex flex-col gap-1 p-3 rounded-lg bg-green-500/10 text-green-700">
                    <span className="text-2xl font-semibold">{account.leadsQualified}</span>
                    <span className="text-xs font-medium">Qualified</span>
                  </div>
                  <div className="flex flex-col gap-1 p-3 rounded-lg bg-yellow-500/10 text-yellow-700">
                    <span className="text-2xl font-semibold">{account.leadsNeedsReview}</span>
                    <span className="text-xs font-medium">Needs Review</span>
                  </div>
                  <div className="flex flex-col gap-1 p-3 rounded-lg bg-red-500/10 text-red-700">
                    <span className="text-2xl font-semibold">{account.leadsUnqualified}</span>
                    <span className="text-xs font-medium">Unqualified</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-3">Recent Projects</h3>
                {account.projects.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                    <p className="text-sm">No projects created yet.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {account.projects.slice(0, 3).map(p => (
                      <Link
                        key={p.id}
                        href={`/v2/workspace/accounts?view=projects&accountId=${account.id}&projectId=${p.id}`}
                        className="group flex items-center justify-between rounded-xl border bg-card p-3 shadow-sm hover:border-primary/50"
                      >
                        <div>
                          <p className="font-medium text-sm">{p.name}</p>
                        </div>
                        <ArrowRightIcon className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="projects" className="m-0 focus-visible:outline-none">
            <div className="flex flex-col gap-3">
              {account.projects.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
                  No projects in this account.
                </div>
              ) : (
                account.projects.map(p => (
                  <Link key={p.id} href={`/v2/workspace/accounts?view=projects&accountId=${account.id}&projectId=${p.id}`} className="group block rounded-xl border bg-card p-4 hover:border-primary/50 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold">{p.name}</span>
                      <ArrowRightIcon className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-4">
                      <span>{p.offers.length} Offers</span>
                      <span>Created {formatDate(p.createdAt)}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </TabsContent>
          <TabsContent value="offers" className="m-0 focus-visible:outline-none">
            <div className="flex flex-col gap-3">
              {account.projects.flatMap(p => p.offers).length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
                  No offers in this account.
                </div>
              ) : (
                account.projects.flatMap(p => p.offers).map(o => (
                  <Link key={o.id} href={`/v2/offers/${o.id}`} className="group block rounded-xl border bg-card p-4 hover:border-primary/50 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold">{o.name}</span>
                      <ArrowRightIcon className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-4">
                      <span>{o.icpProfiles.length} ICPs</span>
                      <span>Created {formatDate(o.createdAt)}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </TabsContent>
          <TabsContent value="icps" className="m-0 focus-visible:outline-none">
            <div className="flex flex-col gap-3">
              {account.projects.flatMap(p => p.offers).flatMap(o => o.icpProfiles).length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
                  No ICP profiles in this account.
                </div>
              ) : (
                account.projects.flatMap(p => p.offers.flatMap(o => o.icpProfiles.map(icp => ({ icp, projectId: p.id })))).map(({ icp, projectId }) => (
                  <Link key={icp.id} href={`/v2/icp-library?projectId=${projectId}`} className="group block rounded-xl border bg-card p-4 hover:border-primary/50 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold">{icp.name}</span>
                      <ArrowRightIcon className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-4">
                      <span>{icp.versions.length} Published Versions</span>
                      <span>Created {formatDate(icp.createdAt)}</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </TabsContent>
          <TabsContent value="leads" className="m-0 focus-visible:outline-none">
            <div className="flex flex-col gap-3">
              {companyGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
                  No leads or companies in scope.
                </div>
              ) : (
                companyGroups.slice(0, 20).map(group => (
                  <div key={group.companyId} className="group flex flex-col rounded-xl border bg-card hover:border-primary/50 transition-colors overflow-hidden">
                    <div className="flex justify-between items-center p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-sm">{group.companyName}</span>
                        <span className="text-xs text-muted-foreground">{group.leads.length} in-scope contacts/leads</span>
                      </div>
                    </div>
                    {group.leads.length > 0 && (
                      <div className="border-t bg-muted/10 divide-y">
                        {group.leads.map(lead => (
                          <div key={lead.id} className="flex justify-between items-center p-3 px-4">
                            <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {lead.contact ? lead.contact.fullName : "Company-level Lead"}
                            </span>
                            <div className="flex items-center gap-3">
                              {lead.latestHardRuleAssessment && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${lead.latestHardRuleAssessment.qualification === 'QUALIFIED' ? 'bg-green-100 text-green-700' : lead.latestHardRuleAssessment.qualification === 'NEEDS_REVIEW' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                  {lead.latestHardRuleAssessment.qualification}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground capitalize">{lead.workflowStatus.toLowerCase().replace('_', ' ')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </TabsContent>
          <TabsContent value="activity" className="m-0 focus-visible:outline-none text-muted-foreground">
            <div className="rounded-xl border border-dashed p-6 text-center text-sm">
              Activity recap for this account.
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </V2DetailDrawer>
  );
}
