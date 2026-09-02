import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Bot, Building2, CalendarCheck, CheckCircle2, ClipboardCheck,
  FolderKanban, Target, TrendingUp, UploadCloud, User, Users, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { PanelCard } from "@/components/shared/PanelCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { PipelineFlowWidget } from "@/components/v2/shell/PipelineFlowWidget";
import { queryHomeOverview } from "@/lib/v2/home/queryHomeOverview";
import { queryPipelineStages } from "@/lib/v2/home/queryPipelineStages";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

// Home — the operator's triage surface. Not a metrics wall: it answers "what needs me, and how do
// I keep the pipeline moving", then recedes into supporting context. Every number is real (queryHome
// Overview + queryPipelineStages); the pipeline strip runs the next stage inline.

export default async function V2HomePage() {
  const context = await getHomeContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const [overview, pipeline] = await Promise.all([
    queryHomeOverview(context.organizationId),
    queryPipelineStages(context.organizationId),
  ]);
  const { metrics, funnel, nextActions, dataHealth, recentProjects, teamActivities, pendingApprovals } = overview;

  const kpis: { label: string; value: number; trendPct: number; icon: LucideIcon }[] = [
    { label: "Leads assigned", value: metrics.leadsAssigned.value, trendPct: metrics.leadsAssigned.trendPct, icon: Users },
    { label: "Meetings booked", value: metrics.meetingsBooked.value, trendPct: metrics.meetingsBooked.trendPct, icon: CalendarCheck },
    { label: "Companies in review", value: metrics.companiesInReview.value, trendPct: metrics.companiesInReview.trendPct, icon: Building2 },
    { label: "Active projects", value: metrics.activeProjects.value, trendPct: metrics.activeProjects.trendPct, icon: FolderKanban },
  ];

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title={`${greeting()}`}
        description="Here's what needs you, and where your pipeline stands right now."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/v2/workspace/leads" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted/50">
              Open leads
            </Link>
            <Link href="/v2/ingestion/uploads" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
              <UploadCloud className="h-4 w-4" aria-hidden="true" /> Import a list
            </Link>
          </div>
        }
      />

      <div className="mx-auto max-w-[1400px] space-y-6 px-5 pb-10 sm:px-6">
        <PipelineFlowWidget
          enrichCount={pipeline.enrichCount}
          scoreCount={pipeline.scoreCount}
          reviewCount={pipeline.reviewCount}
          enrichCompanyIds={pipeline.enrichCompanyIds}
        />

        {/* Triage — the focal row: what needs a decision, and what to do next. */}
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <PanelCard
            title="Needs your review"
            description="Approvals and review items waiting on a human decision."
            actions={<Link href="/v2/reviews" className="text-xs font-semibold text-primary hover:text-primary/80">Review queue</Link>}
            contentClassName="p-0"
          >
            {pendingApprovals.length === 0 ? (
              <CaughtUp />
            ) : (
              <ul className="divide-y divide-border/70">
                {pendingApprovals.slice(0, 6).map((pa) => (
                  <li key={pa.id}>
                    <Link href="/v2/reviews" className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${pa.type.includes("icp") ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground"}`}>
                        {pa.type.includes("icp") ? <Target className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold capitalize text-foreground">{pa.title.toLowerCase()}</div>
                        <div className="truncate text-xs text-muted-foreground">Updated by {pa.updatedBy}{pa.due && pa.due !== "No due date" ? ` · due ${pa.due}` : ""}</div>
                      </div>
                      <PriorityChip priority={pa.priority} />
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <PanelCard title="Next actions" description="Where to spend the next few minutes." contentClassName="space-y-2.5">
            {nextActions.length === 0 && dataHealth.failedJobs === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing queued — start by importing a list or working your leads.</p>
            ) : (
              <>
                {nextActions.map((a) => (
                  <ActionRow key={a.id} href={a.href} icon={a.id === "review" ? ClipboardCheck : a.id === "failed_jobs" ? AlertTriangle : Users} label={a.label} count={a.count} tone={a.id === "failed_jobs" ? "warn" : "default"} />
                ))}
                {dataHealth.failedJobs > 0 && !nextActions.some((a) => a.id === "failed_jobs") ? (
                  <ActionRow href="/v2/ingestion/jobs" icon={AlertTriangle} label="Failed jobs need attention" count={dataHealth.failedJobs} tone="warn" />
                ) : null}
                <ActionRow href="/v2/ai" icon={Bot} label="Tune the AI engine" tone="muted" />
              </>
            )}
          </PanelCard>
        </div>

        {/* Compact KPI rail — secondary context, real numbers with honest trend. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => <StatTile key={k.label} {...k} />)}
        </div>

        {/* Supporting panels. */}
        <div className="grid gap-6 lg:grid-cols-3">
          <PanelCard title="Recent projects" actions={<Link href="/v2/workspace/accounts?view=projects" className="text-xs font-semibold text-primary hover:text-primary/80">All</Link>} contentClassName="p-2">
            {recentProjects.length === 0 ? (
              <EmptyLine title="No active projects" sub="Create a project to start scoring accounts." />
            ) : (
              <ul className="space-y-0.5">
                {recentProjects.slice(0, 5).map((rp) => (
                  <li key={rp.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-xs font-bold text-primary">{rp.name.slice(0, 2).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{rp.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{rp.account} · {relativeTime(rp.updatedAt)}</div>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold ${rp.stage === "In Progress" ? "text-primary" : "text-muted-foreground"}`}>{rp.stage}</span>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <PanelCard title="Team activity" actions={<Link href="/v2/reports" className="text-xs font-semibold text-primary hover:text-primary/80">Reports</Link>}>
            {teamActivities.length === 0 ? (
              <EmptyLine title="No activity yet" sub="Actions across the team show up here." />
            ) : (
              <ul className="space-y-4">
                {teamActivities.slice(0, 6).map((act) => (
                  <li key={act.id} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
                      {act.user === "AI" ? <Zap className="h-4 w-4 text-amber-500" /> : <User className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm leading-snug text-foreground/80"><span className="font-semibold text-foreground">{act.user}</span> {act.action}</p>
                      <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">{act.time}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <PanelCard title="Pipeline health" description="Qualified and won across active leads.">
            <div className="space-y-4">
              <FunnelBar label="Total leads" value={funnel.totalLeads} total={funnel.totalLeads} />
              <FunnelBar label="Qualified" value={funnel.qualified} total={funnel.totalLeads} hint={`${Math.round(funnel.qualifiedRate * 100)}%`} />
              <FunnelBar label="In progress" value={funnel.inProgress} total={funnel.totalLeads} />
              <FunnelBar label="Won" value={funnel.won} total={funnel.totalLeads} hint={`${Math.round(funnel.winRate * 100)}%`} tone="win" />
            </div>
          </PanelCard>
        </div>
      </div>
    </WorkspaceFrame>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function StatTile({ label, value, trendPct, icon: Icon }: { label: string; value: number; trendPct: number; icon: LucideIcon }) {
  const up = trendPct >= 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="h-4 w-4" /></span>
        {trendPct !== 0 ? (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            <TrendingUp className={`h-3 w-3 ${up ? "" : "rotate-180"}`} aria-hidden="true" />{Math.abs(trendPct)}%
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

function ActionRow({ href, icon: Icon, label, count, tone = "default" }: { href: string; icon: LucideIcon; label: string; count?: number; tone?: "default" | "warn" | "muted" }) {
  const iconCls = tone === "warn" ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" : tone === "muted" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary";
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-border/70 bg-background/40 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconCls}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      {typeof count === "number" ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-bold tabular-nums text-foreground">{count}</span> : null}
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  const p = priority.toUpperCase();
  const cls = p === "HIGH" || p === "CRITICAL"
    ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
    : p === "NORMAL"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-muted text-muted-foreground";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{p.charAt(0) + p.slice(1).toLowerCase()}</span>;
}

function FunnelBar({ label, value, total, hint, tone }: { label: string; value: number; total: number; hint?: string; tone?: "win" }) {
  const pct = total > 0 ? Math.max(2, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-bold tabular-nums text-foreground">{value.toLocaleString()}{hint ? <span className="ml-1.5 text-xs font-semibold text-muted-foreground">{hint}</span> : null}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone === "win" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CaughtUp() {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"><CheckCircle2 className="h-5 w-5" /></span>
      <div className="text-sm font-semibold text-foreground">You&apos;re all caught up</div>
      <p className="max-w-xs text-xs text-muted-foreground">No approvals waiting. Keep the pipeline moving from the strip above, or work your leads.</p>
    </div>
  );
}

function EmptyLine({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-3 py-8 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

// Honest "updated X ago" from a real ISO timestamp.
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function getHomeContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
