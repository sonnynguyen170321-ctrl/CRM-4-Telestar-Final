"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Contact,
  FolderKanban,
  Layers3,
  ListChecks,
  Package,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { createAccountAction } from "@/app/v2/workspace/accounts/actions";
import { createProjectAction } from "@/app/v2/workspace/projects/actions";
import { createOfferAction } from "@/app/v2/offers/actions";
import type {
  AccountWorkspaceIcpRow,
  AccountWorkspaceOfferRow,
  AccountWorkspaceProjectRow,
  AccountWorkspaceView,
  WorkspaceInsightEntity,
  WorkspaceReadiness,
  WorkspaceRunningWorkItem,
} from "@/lib/v2/product-tree/types";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { cn } from "@/lib/utils";

const tabs: Array<{ key: AccountWorkspaceView["view"]; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "projects", label: "Projects" },
  { key: "offers", label: "Offers" },
  { key: "icps", label: "ICPs" },
  { key: "companies", label: "Companies" },
  { key: "contacts", label: "Contacts" },
  { key: "leads", label: "Leads" },
  { key: "activity", label: "Activity" },
];

export function AccountWorkspaceClient({
  workspace,
  createMode,
}: {
  workspace: AccountWorkspaceView;
  createMode: "account" | "project" | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [accountOpen, setAccountOpen] = React.useState(createMode === "account");
  const [projectOpen, setProjectOpen] = React.useState(createMode === "project");
  const [offerOpen, setOfferOpen] = React.useState(false);
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);
  const [offerError, setOfferError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedProjectIdForOfferCreate, setSelectedProjectIdForOfferCreate] = React.useState<string>("");

  const selectedAccountId = workspace.selectedContext.accountId ?? workspace.accounts.rows[0]?.id ?? "";
  const selectedProjectId = workspace.selectedContext.projectId ?? workspace.projects.rows[0]?.id ?? "";
  const selectedOfferId = workspace.selectedContext.offerId ?? workspace.offers.rows[0]?.id ?? "";

  function href(updates: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") params.delete(key);
      else params.set(key, value);
    });
    if (updates.accountId) {
      params.delete("projectId");
      params.delete("offerId");
      params.delete("productId");
      params.delete("icpVersionId");
    }
    if (updates.projectId) {
      params.delete("offerId");
      params.delete("productId");
      params.delete("icpVersionId");
    }
    if (updates.offerId) params.delete("icpVersionId");
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  }

  async function handleAccountCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setAccountError(null);
    const result = await createAccountAction(new FormData(event.currentTarget));
    setIsSubmitting(false);
    if (result?.error) {
      setAccountError(result.error);
      return;
    }
    setAccountOpen(false);
    if (result.account) router.push(`/v2/workspace/accounts?accountId=${result.account.id}&drawer=account`);
  }

  async function handleProjectCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setProjectError(null);
    const result = await createProjectAction(new FormData(event.currentTarget));
    setIsSubmitting(false);
    if (result?.error) {
      setProjectError(result.error);
      return;
    }
    setProjectOpen(false);
    if (result.project) router.push(`/v2/workspace/accounts?accountId=${result.project.clientAccountId}&projectId=${result.project.id}&view=projects&drawer=project`);
  }

  async function handleOfferCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setOfferError(null);
    const result = await createOfferAction(new FormData(event.currentTarget));
    setIsSubmitting(false);
    if (result?.error) {
      setOfferError(result.error);
      return;
    }
    setOfferOpen(false);
    if (result.offer) {
      router.push(`/v2/workspace/accounts?accountId=${selectedAccountId}&projectId=${result.offer.projectId}&offerId=${result.offer.id}&view=offers&drawer=offer`);
    }
  }

  return (
    <div className="space-y-5">
      <TopHealthStrip workspace={workspace} onCreateAccount={() => setAccountOpen(true)} onCreateProject={() => setProjectOpen(true)} />

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <AccountRail workspace={workspace} href={href} selectedAccountId={selectedAccountId} onCreateAccount={() => setAccountOpen(true)} />

        <main className="min-w-0 space-y-4">
          <FlowNavigator workspace={workspace} href={href} />
          <ScopedTabs active={workspace.view} href={href} />
          <HierarchyCockpit
            workspace={workspace}
            href={href}
            selectedProjectId={selectedProjectId}
            selectedOfferId={selectedOfferId}
            onCreateProject={() => setProjectOpen(true)}
            onCreateOffer={(projectId) => {
              setSelectedProjectIdForOfferCreate(projectId);
              setOfferOpen(true);
            }}
          />
          <ScopedPanel workspace={workspace} />
        </main>

        <IntelligenceRail workspace={workspace} selectedAccountId={selectedAccountId} selectedProjectId={selectedProjectId} selectedOfferId={selectedOfferId} />
      </div>

      <ContextDrawer workspace={workspace} href={href} />

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogTrigger asChild><span className="sr-only">Create account</span></DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleAccountCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create account</DialogTitle>
              <DialogDescription>Add a managed account before creating projects, offers, ICPs, and leads.</DialogDescription>
            </DialogHeader>
            <Input name="name" placeholder="Account name" required />
            <Textarea name="description" placeholder="Management notes" />
            {accountError ? <ErrorText>{accountError}</ErrorText> : null}
            <DialogFooter><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create account"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogTrigger asChild><span className="sr-only">Create project</span></DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleProjectCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>Projects sit under the selected account and contain offers, ICPs, and lead queues.</DialogDescription>
            </DialogHeader>
            <Select name="clientAccountId" defaultValue={selectedAccountId || workspace.accounts.rows[0]?.id} required>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>{workspace.accounts.rows.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input name="name" placeholder="Project name" required />
            <Textarea name="description" placeholder="Project notes" />
            {projectError ? <ErrorText>{projectError}</ErrorText> : null}
            <DialogFooter><Button type="submit" disabled={isSubmitting || !workspace.accounts.rows.length}>{isSubmitting ? "Creating..." : "Create project"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogTrigger asChild><span className="sr-only">Create offer</span></DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          {/* key remounts the Select so the project clicked in the tree (or the active project) is
              pre-selected each time this opens. Was previously missing entirely — the "Add offer"
              buttons flipped offerOpen but no dialog existed to render. */}
          <form onSubmit={handleOfferCreate} className="space-y-4" key={selectedProjectIdForOfferCreate || selectedProjectId || "offer"}>
            <DialogHeader>
              <DialogTitle>Create offer</DialogTitle>
              <DialogDescription>Offers sit under a project and hold ICP versions + lead queues.</DialogDescription>
            </DialogHeader>
            <Select name="projectId" defaultValue={selectedProjectIdForOfferCreate || selectedProjectId || workspace.projects.rows[0]?.id} required>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>{workspace.projects.rows.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input name="name" placeholder="Offer name" required />
            <Textarea name="description" placeholder="Offer notes" />
            {offerError ? <ErrorText>{offerError}</ErrorText> : null}
            <DialogFooter><Button type="submit" disabled={isSubmitting || !workspace.projects.rows.length}>{isSubmitting ? "Creating..." : "Create offer"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TopHealthStrip({ workspace, onCreateAccount, onCreateProject }: { workspace: AccountWorkspaceView; onCreateAccount: () => void; onCreateProject: () => void }) {
  const stats = [
    ["Accounts", workspace.overview.accountsCount],
    ["Projects", workspace.overview.projectsCount],
    ["Offers", workspace.overview.offersCount],
    ["ICP versions", workspace.overview.icpVersionsCount],
    ["Leads", workspace.overview.leadsTotal],
    ["Needs review", workspace.overview.leadsNeedsReview],
    ["Queued", workspace.overview.scheduledMessages],
    ["Replies", workspace.overview.repliedMessages],
  ] as const;
  return (
    <section className="rounded-lg border border-hairline bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-foreground"><Sparkles className="h-4 w-4 text-primary" />Account, Project, Offer, and ICP</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Management view for setup health, running work, and lead/customer signals without leaving Accounts.</p>
        </div>
        <div className="flex gap-2"><Button variant="outline" className="border-hairline bg-surface shadow-sm" onClick={onCreateAccount}><Plus className="mr-2 h-4 w-4" />Account</Button><Button className="shadow-sm" onClick={onCreateProject}><Plus className="mr-2 h-4 w-4" />Project</Button></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {stats.map(([label, value]) => <MiniStat key={label} label={label} value={value ?? 0} />)}
      </div>
    </section>
  );
}

function AccountRail({ workspace, href, selectedAccountId, onCreateAccount }: { workspace: AccountWorkspaceView; href: (updates: Record<string, string | null | undefined>) => string; selectedAccountId: string; onCreateAccount: () => void }) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <div className="rounded-lg border border-hairline bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-foreground">Accounts</h2><Button size="sm" variant="outline" className="border-hairline bg-surface shadow-sm" onClick={onCreateAccount}><Plus className="h-4 w-4" /></Button></div>
        <form action="/v2/workspace/accounts" className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-hairline bg-surface px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input name="search" defaultValue="" placeholder="Search accounts..." className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60" />
        </form>
      </div>
      <div className="max-h-[72vh] space-y-2 overflow-auto pr-1">
        {workspace.accounts.rows.length ? workspace.accounts.rows.map((account) => (
          <Link key={account.id} href={href({ accountId: account.id, view: "overview", drawer: "account" })} className={cn("block rounded-xl border p-3 transition-colors duration-200 shadow-sm", account.id === selectedAccountId ? "border-primary bg-primary/5" : "border-hairline bg-surface hover:bg-surface-raised")}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-bold text-foreground">{account.name}</div><div className="mt-1 text-xs text-muted-foreground">{account.projectCount} projects / {account.offerCount} offers / {account.icpVersionCount} ICPs</div></div><RiskPill readiness={account.readiness} /></div>
            <div className="mt-3 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground"><MiniStat label="Leads" value={account.leadsTotal} /><MiniStat label="Run" value={account.activeEnrollments + account.scheduledMessages} /><MiniStat label="Review" value={account.leadsNeedsReview + account.leadsNotScored} /></div>
          </Link>
        )) : <EmptyState icon={Building2} title="No accounts" description="Create the first account to start the management flow." />}
      </div>
    </aside>
  );
}

function FlowNavigator({ workspace, href }: { workspace: AccountWorkspaceView; href: (updates: Record<string, string | null | undefined>) => string }) {
  const items = [
    { label: "Account", icon: Building2, value: workspace.selectedAccount?.name ?? "Select account", href: href({ drawer: "account", view: "overview" }) },
    { label: "Project", icon: FolderKanban, value: workspace.selectedProject?.name ?? "Select project", href: href({ drawer: "project", view: "projects" }) },
    { label: "Offer", icon: Package, value: workspace.selectedOffer?.name ?? "Select offer", href: href({ drawer: "offer", view: "offers" }) },
    { label: "ICP", icon: ListChecks, value: workspace.selectedIcp ? `${workspace.selectedIcp.profileName} v${workspace.selectedIcp.versionNumber}` : "Select ICP", href: href({ drawer: "icp", view: "icps" }) },
  ];
  return <section className="rounded-lg border border-hairline bg-surface p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-4">{items.map((item, index) => <Link key={item.label} href={item.href} className="group min-h-20 rounded-xl border border-hairline bg-surface p-3 hover:border-primary/40 hover:bg-primary/5 transition-colors duration-200"><div className="flex items-center justify-between text-xs font-semibold text-muted-foreground"><span className="inline-flex items-center gap-2"><item.icon className="h-4 w-4" />{item.label}</span>{index < items.length - 1 ? <ChevronRight className="h-4 w-4 text-muted-foreground/40" /> : null}</div><div className="mt-2 line-clamp-2 text-sm font-bold text-foreground group-hover:text-primary transition-colors">{item.value}</div></Link>)}</div></section>;
}

function ScopedTabs({ active, href }: { active: AccountWorkspaceView["view"]; href: (updates: Record<string, string | null | undefined>) => string }) {
  return <nav className="flex gap-2 overflow-x-auto rounded-xl border border-hairline bg-surface p-2 shadow-sm" aria-label="Account workspace tabs">{tabs.map((tab) => <Link key={tab.key} href={href({ view: tab.key })} className={tabCls(active === tab.key)}>{tab.label}</Link>)}</nav>;
}

function HierarchyCockpit({ workspace, href, selectedProjectId, selectedOfferId, onCreateProject, onCreateOffer }: { workspace: AccountWorkspaceView; href: (updates: Record<string, string | null | undefined>) => string; selectedProjectId: string; selectedOfferId: string; onCreateProject: () => void; onCreateOffer: (projectId: string) => void }) {
  if (!workspace.selectedContext.accountId) return <EmptyState icon={Building2} title="Select an account" description="Choose an account to inspect projects, offers, ICPs, leads, and running work." />;
  if (!workspace.projects.rows.length) return <EmptyState icon={FolderKanban} title="No projects in this account" description="Create a project so offers, ICPs, and leads have a management context." action={<Button className="shadow-sm" onClick={onCreateProject}><Plus className="mr-2 h-4 w-4" />Create project</Button>} />;
  return (
    <section className="rounded-lg border border-hairline bg-surface shadow-sm">
      <div className="border-b border-hairline px-4 py-3"><h2 className="text-sm font-bold text-foreground">Running hierarchy</h2><p className="text-xs text-muted-foreground">Nested management map: Account, Project, Offer, and ICP.</p></div>
      <div className="divide-y divide-hairline">
        {workspace.projects.rows.map((project) => {
          const projectOffers = workspace.offers.rows.filter((offer) => offer.projectId === project.id);
          return (
            <div key={project.id} className={cn("p-4 transition-colors", project.id === selectedProjectId && "bg-primary/5")}>
              <HierarchyProjectRow project={project} href={href} selectedOfferId={selectedOfferId} selectedIcpVersionId={workspace.selectedContext.icpVersionId ?? undefined} onCreateOffer={onCreateOffer} />
              <div className="mt-3 space-y-2 pl-0 md:pl-6">
                {projectOffers.length ? (
                  projectOffers.map((offer) => (
                    <OfferNode key={offer.id} offer={offer} icps={workspace.icps.rows.filter((icp) => icp.offerId === offer.id)} href={href} selectedOfferId={selectedOfferId} />
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-surface p-3 text-sm text-muted-foreground flex items-center justify-between">
                    <span>No offer yet. Add an offer before ICP and lead execution can run.</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs shadow-sm" onClick={() => onCreateOffer(project.id)}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add offer
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HierarchyProjectRow({ project, href, selectedOfferId, selectedIcpVersionId, onCreateOffer }: { project: AccountWorkspaceProjectRow; href: (updates: Record<string, string | null | undefined>) => string; selectedOfferId?: string; selectedIcpVersionId?: string; onCreateOffer: (projectId: string) => void }) {
  return <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><Link href={href({ accountId: project.accountId, projectId: project.id, view: "projects", drawer: "project" })} className="group inline-flex min-h-11 items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm"><FolderKanban className="h-4 w-4" /></span><span><span className="block font-bold text-foreground group-hover:text-primary transition-colors">{project.name}</span><span className="text-xs text-muted-foreground">Owner: {project.ownerName} / {project.leadsTotal} leads / {project.leadsNeedsReview + project.leadsNotScored} review</span></span></Link><div className="flex items-center gap-2"><RiskPill readiness={project.readiness} /><ActionLink readiness={project.readiness} accountId={project.accountId} projectId={project.id} offerId={selectedOfferId} icpVersionId={selectedIcpVersionId} /><Button variant="outline" size="sm" className="h-8 w-8 p-0 border-hairline shadow-sm hover:bg-surface-raised" onClick={() => onCreateOffer(project.id)} title="Add offer to project"><Plus className="h-4 w-4" /></Button></div></div>;
}

function OfferNode({ offer, icps, href, selectedOfferId }: { offer: AccountWorkspaceOfferRow; icps: AccountWorkspaceIcpRow[]; href: (updates: Record<string, string | null | undefined>) => string; selectedOfferId: string }) {
  return <div className={cn("rounded-xl border p-3 transition-colors duration-200", offer.id === selectedOfferId ? "border-primary bg-primary/5" : "border-hairline bg-surface shadow-sm")}><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><Link href={href({ projectId: offer.projectId, offerId: offer.id, view: "offers", drawer: "offer" })} className="inline-flex min-h-10 items-center gap-2 font-bold text-foreground hover:text-primary transition-colors"><Package className="h-4 w-4 text-indigo-500" />{offer.name}</Link><div className="flex items-center gap-2"><RiskPill readiness={offer.readiness} /><span className="text-xs text-muted-foreground font-semibold">{offer.leadsTotal} leads</span></div></div><div className="mt-3 flex flex-wrap gap-2">{icps.length ? icps.map((icp) => <Link key={icp.id} href={href({ projectId: icp.projectId, offerId: icp.offerId, icpVersionId: icp.id, view: "icps", drawer: "icp" })} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-2.5 text-xs font-semibold hover:bg-surface-raised transition-colors"><ListChecks className="h-3.5 w-3.5 text-muted-foreground" />{icp.profileName} v{icp.versionNumber}<RiskDot readiness={icp.readiness} /></Link>) : <span className="text-xs text-muted-foreground font-semibold">No ICP versions for this offer.</span>}</div></div>;
}

function ScopedPanel({ workspace }: { workspace: AccountWorkspaceView }) {
  if (workspace.view === "companies") return <InsightTable title="Companies in scope" icon={Building2} rows={workspace.selectedContext.companies} />;
  if (workspace.view === "contacts") return <InsightTable title="Contacts in scope" icon={Contact} rows={workspace.selectedContext.contacts} />;
  if (workspace.view === "leads") return <InsightTable title="Lead queue in scope" icon={Users} rows={workspace.selectedContext.leads} />;
  if (workspace.view === "activity") return <RunningWorkPanel items={workspace.selectedContext.runningWork} />;
  return <MatrixPanel workspace={workspace} />;
}

function MatrixPanel({ workspace }: { workspace: AccountWorkspaceView }) {
  return <section className="grid gap-3 lg:grid-cols-3"><HealthCard title="Setup" icon={Layers3} fields={[["Projects", workspace.projects.rows.length], ["Offers", workspace.offers.rows.length], ["ICPs", workspace.icps.rows.length]]} /><HealthCard title="Data quality" icon={Users} fields={[["Companies", workspace.selectedContext.health.companiesTotal], ["Enriched", workspace.selectedContext.health.companiesEnriched], ["Missing email", workspace.selectedContext.health.contactsMissingEmail]]} /><HealthCard title="Execution" icon={Activity} fields={[["Active", workspace.selectedContext.health.activeEnrollments], ["Queued", workspace.selectedContext.health.scheduledMessages], ["Failed", workspace.selectedContext.health.failedMessages + workspace.selectedContext.health.bouncedMessages]]} /></section>;
}

function HealthCard({ title, icon: Icon, fields }: { title: string; icon: LucideIcon; fields: Array<[string, number]> }) {
  return <section className="rounded-lg border border-hairline bg-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-bold text-foreground"><Icon className="h-4 w-4 text-primary" />{title}</div><div className="mt-3 grid grid-cols-3 gap-2">{fields.map(([label, value]) => <MiniStat key={label} label={label} value={value} />)}</div></section>;
}

function InsightTable({ title, icon: Icon, rows }: { title: string; icon: LucideIcon; rows: WorkspaceInsightEntity[] }) {
  const empty = (
    <EmptyState
      icon={Icon}
      title="No rows in this scope"
      description="Select a more specific account, project, offer, or ICP to inspect related records."
    />
  );

  const columns: DataTableColumn<WorkspaceInsightEntity>[] = [
    {
      key: "name",
      header: "Name",
      cell: (row) => <span className="font-semibold text-foreground">{row.name}</span>,
    },
    {
      key: "context",
      header: "Context",
      cell: (row) => <span className="text-muted-foreground">{row.subtitle}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <span className="rounded-lg border border-hairline bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">
          {row.status}
        </span>
      ),
    },
    {
      key: "open",
      header: "",
      align: "right",
      cell: (row) => (
        <Link
          href={row.href}
          className="inline-flex min-h-9 items-center rounded-lg border border-hairline bg-surface px-2.5 text-xs font-semibold hover:bg-surface-raised transition-colors"
        >
          Inspect
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      title={
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span>{title}</span>
        </div>
      }
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      minWidth="min-w-[640px]"
      empty={empty}
      className="shadow-sm border-hairline"
    />
  );
}

function RunningWorkPanel({ items }: { items: WorkspaceRunningWorkItem[] }) {
  return <section className="rounded-lg border border-hairline bg-surface shadow-sm"><div className="border-b border-hairline px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-bold text-foreground"><Activity className="h-4 w-4 text-primary" />Running now and recent signals</h2></div>{items.length ? <div className="divide-y divide-hairline">{items.map((item) => <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-raised/40 transition-colors"><div className="min-w-0"><div className="truncate text-sm font-semibold text-foreground">{item.label}</div><div className="text-xs text-muted-foreground">{item.context}</div></div><span className="rounded-lg border border-hairline bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">{item.status}</span></div>)}</div> : <EmptyState icon={Activity} title="No running work" description="No active runtime, outreach, or recent activity surfaced for this scope." />}</section>;
}

function IntelligenceRail({ workspace, selectedAccountId, selectedProjectId, selectedOfferId }: { workspace: AccountWorkspaceView; selectedAccountId: string; selectedProjectId: string; selectedOfferId: string }) {
  const readiness = workspace.selectedContext.readiness;
  return <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start"><section className="rounded-lg border border-hairline bg-surface shadow-sm"><div className="border-b border-hairline px-4 py-3"><h2 className="text-sm font-bold text-foreground">Account intelligence</h2><p className="text-xs text-muted-foreground">Deterministic diagnosis from existing V2 data.</p></div><div className="space-y-4 p-4"><ContextTitle workspace={workspace} />{readiness ? <ReadinessChecklist readiness={readiness} /> : <div className="rounded-lg border border-dashed border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">Select an account to see blockers.</div>}</div></section><section className="rounded-lg border border-hairline bg-surface p-4 shadow-sm"><div className="text-sm font-bold text-foreground">Next action queue</div>{readiness ? <div className="mt-3 space-y-3"><div className="rounded-xl border border-hairline bg-secondary p-3 text-sm text-foreground"><div className="font-bold">{readiness.nextAction}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">Primary workflow stays inside this account cockpit unless a setup form already lives in a specialist V2 page.</div></div><ActionLink readiness={readiness} accountId={selectedAccountId} projectId={selectedProjectId} offerId={selectedOfferId} icpVersionId={workspace.selectedContext.icpVersionId ?? undefined} wide /></div> : null}</section><RunningWorkCompact items={workspace.selectedContext.runningWork} /></aside>;
}

function ContextTitle({ workspace }: { workspace: AccountWorkspaceView }) {
  const title = workspace.selectedIcp ? `${workspace.selectedIcp.profileName} v${workspace.selectedIcp.versionNumber}` : workspace.selectedOffer?.name ?? workspace.selectedProject?.name ?? workspace.selectedAccount?.name ?? "No context selected";
  const subtitle = workspace.selectedIcp?.offerName ?? workspace.selectedOffer?.project.name ?? workspace.selectedProject?.clientAccount.name ?? "Account workspace";
  return <div><div className="text-xs font-semibold uppercase text-muted-foreground">Current scope</div><div className="mt-1 text-base font-semibold text-foreground">{title}</div><div className="text-xs text-muted-foreground">{subtitle}</div></div>;
}

function RunningWorkCompact({ items }: { items: WorkspaceRunningWorkItem[] }) {
  return <section className="rounded-lg border border-hairline bg-surface p-4 shadow-sm"><div className="text-sm font-bold text-foreground">What is running</div><div className="mt-3 space-y-2">{items.slice(0, 5).map((item) => <div key={`${item.kind}-${item.id}`} className="rounded-lg border border-hairline bg-surface-raised p-2.5 text-xs shadow-sm"><div className="font-bold text-foreground">{item.label}</div><div className="mt-1 text-muted-foreground">{item.status} / {item.context}</div></div>)}{!items.length ? <div className="text-sm text-muted-foreground font-semibold">No active work in this scope.</div> : null}</div></section>;
}

function ContextDrawer({ workspace, href }: { workspace: AccountWorkspaceView; href: (updates: Record<string, string | null | undefined>) => string }) {
  if (!workspace.selectedContext.drawer) return null;
  const readiness = workspace.selectedContext.readiness;
  return <div className="fixed inset-0 z-40 bg-black/40 xl:pointer-events-none xl:bg-transparent"><aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-hairline bg-surface shadow-sm xl:pointer-events-auto"><div className="flex min-h-16 items-center justify-between border-b border-hairline px-4 bg-surface-raised/40"><div><div className="text-xs font-semibold text-muted-foreground">{workspace.selectedContext.drawer} detail</div><ContextTitle workspace={workspace} /></div><Link href={href({ drawer: null })} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors" aria-label="Close drawer"><X className="h-4 w-4" /></Link></div><div className="flex-1 space-y-4 overflow-auto p-4">{readiness ? <ReadinessChecklist readiness={readiness} /> : null}<MatrixPanel workspace={workspace} /><RunningWorkPanel items={workspace.selectedContext.runningWork} /><InsightTable title="Companies" icon={Building2} rows={workspace.selectedContext.companies.slice(0, 6)} /><InsightTable title="Contacts" icon={Contact} rows={workspace.selectedContext.contacts.slice(0, 6)} /><InsightTable title="Leads" icon={Users} rows={workspace.selectedContext.leads.slice(0, 6)} /></div></aside></div>;
}

function ReadinessChecklist({ readiness }: { readiness: WorkspaceReadiness }) {
  return <ul className="space-y-2">{readiness.checks.map((check) => { const Icon = check.ok ? CheckCircle2 : AlertTriangle; return <li key={check.key} className="flex gap-3 rounded-xl border border-hairline bg-surface p-3 shadow-sm"><Icon className={cn("mt-0.5 h-4 w-4 shrink-0", check.ok ? "text-emerald-500" : "text-amber-500")} /><div className="min-w-0"><div className="text-sm font-bold text-foreground">{check.label}</div><div className="text-xs leading-5 text-muted-foreground">{check.detail}</div></div></li>; })}</ul>;
}

function ActionLink({ readiness, accountId, projectId, offerId, icpVersionId, wide = false }: { readiness: WorkspaceReadiness; accountId: string; projectId: string; offerId?: string; icpVersionId?: string; wide?: boolean }) {
  const link = actionHref(readiness.nextAction, accountId, projectId, offerId, icpVersionId);
  return <Link href={link} className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-hairline bg-surface px-3 text-xs font-bold text-foreground hover:bg-surface-raised transition-colors duration-200 shadow-sm", wide && "w-full min-h-11 text-sm")}><span>{readiness.nextAction}</span><ArrowRight className="h-3.5 w-3.5" /></Link>;
}

function actionHref(action: WorkspaceReadiness["nextAction"], accountId: string, projectId: string, offerId?: string, icpVersionId?: string) {
  if (action === "Create project") return `/v2/workspace/accounts?accountId=${accountId}&create=project`;
  if (action === "Add offer") return projectId ? `/v2/offers?projectId=${projectId}&create=true` : `/v2/workspace/accounts?accountId=${accountId}&view=offers&drawer=offer`;
  if (action === "Publish ICP") return projectId ? `/v2/icp-library?projectId=${projectId}` : `/v2/workspace/accounts?accountId=${accountId}&view=icps&drawer=icp`;
  if (action === "Upload leads") {
    const params = new URLSearchParams();
    params.set("clientAccountId", accountId);
    if (projectId) params.set("projectId", projectId);
    if (offerId) params.set("offerId", offerId);
    if (icpVersionId) params.set("icpVersionId", icpVersionId);
    return `/v2/ingestion/uploads?${params.toString()}`;
  }
  if (action === "Enrich companies") return `/v2/workspace/accounts?accountId=${accountId}${projectId ? `&projectId=${projectId}` : ""}&view=companies`;
  if (action === "Assign owners" || action === "Inspect leads") return `/v2/workspace/accounts?accountId=${accountId}${projectId ? `&projectId=${projectId}` : ""}&view=leads`;
  return `/v2/workspace/accounts?accountId=${accountId}${projectId ? `&projectId=${projectId}` : ""}&view=activity`;
}

function RiskPill({ readiness }: { readiness: WorkspaceReadiness }) {
  const cls = readiness.risk === "ready" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : readiness.risk === "blocked" ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400" : "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return <span className={cn("inline-flex min-h-7 items-center rounded-lg border px-2.5 text-xs font-bold", cls)}>{readiness.score}%</span>;
}

function RiskDot({ readiness }: { readiness: WorkspaceReadiness }) {
  return <span className={cn("h-2 w-2 rounded-full", readiness.risk === "ready" ? "bg-emerald-500" : readiness.risk === "blocked" ? "bg-red-500" : "bg-amber-500")} />;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-hairline bg-surface px-2 py-2 text-center shadow-sm"><div className="font-bold tabular-nums text-foreground">{value}</div><div className="text-[10px] font-bold text-muted-foreground  mt-0.5">{label}</div></div>;
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-400 shadow-sm">{children}</div>;
}

function tabCls(active: boolean) {
  return cn("inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold transition-colors duration-200", active ? "bg-primary text-primary-foreground shadow-sm" : "border border-hairline bg-surface text-muted-foreground hover:bg-surface-raised hover:text-foreground");
}
