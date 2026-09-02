import { ArrowUpRight, CheckCircle2, Clock3, Database, Radar, Search, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { CrmNav } from "@/components/v2/shell/WorkspaceClusterNav";
import { ProspectGrid } from "@/components/v2/research/ProspectGrid";
import { ResearchRunRail } from "@/components/v2/research/ResearchRunRail";
import { type ResearchIcpOption } from "@/components/v2/research/ProspectBuilderModal";
import { RunProgressPanel } from "@/components/v2/research/RunProgressPanel";
import { runStatusMeta } from "@/components/v2/research/researchLabels";
import { StatusBadge } from "@/components/shared/statusBadges";
import { prisma } from "@/lib/server/prisma";
import { resolveUsableProviderChain } from "@telestar/core-search/search/env";
import { getResearchRunProgress, type ResearchProgressPayload } from "@/lib/v2/research/progress";
import { buildQueriesForIcp } from "@/lib/v2/research/runResearchDiscovery";
import { queryResearchCandidates, queryResearchRun, queryResearchRuns, type ResearchCandidateRow, type ResearchRunRow } from "@/lib/v2/research/queryResearch";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

// /v2/research: review-first prospecting workspace. Runtime, candidates, drawer, and lead
// promotion render from tenant-scoped read models only; no fabricated stages, rows, or upload jobs.

export const dynamic = "force-dynamic";

export default async function V2ResearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await getContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-xl border border-hairline bg-surface p-6 shadow-sm">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const selectedRunId = typeof params.runId === "string" ? params.runId : undefined;

  const [icpRows, runs] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; rulesJson: unknown; icpProfileName: string; versionNumber: number; projectName: string }>>`
      SELECT icp."id", icp."rulesJson", profile."name" AS "icpProfileName", icp."versionNumber", project."name" AS "projectName"
      FROM "V2ICPVersion" icp
      INNER JOIN "V2ICPProfile" profile
        ON profile."id" = icp."icpProfileId" AND profile."organizationId" = icp."organizationId" AND profile."status" = 'ACTIVE'
      INNER JOIN "V2Offer" offer
        ON offer."id" = profile."offerId" AND offer."organizationId" = icp."organizationId" AND offer."status" = 'ACTIVE'
      INNER JOIN "V2Project" project
        ON project."id" = offer."projectId" AND project."organizationId" = icp."organizationId" AND project."status" = 'ACTIVE'
      WHERE icp."organizationId" = ${context.organizationId} AND icp."status" = 'PUBLISHED' AND icp."deletedAt" IS NULL
      ORDER BY profile."name" ASC, icp."versionNumber" DESC
      LIMIT 50
    `,
    queryResearchRuns(context.organizationId),
  ]);

  const icpOptions: ResearchIcpOption[] = icpRows.map((row) => ({
    id: row.id,
    label: `${row.projectName} / ${row.icpProfileName} v${Number(row.versionNumber)}`,
    companyQueries: buildQueriesForIcp(row.rulesJson, "COMPANY", 1000).map((q) => q.query),
    contactQueries: buildQueriesForIcp(row.rulesJson, "CONTACT", 1000).map((q) => q.query),
  }));

  const activeRunId = selectedRunId ?? runs[0]?.id ?? null;
  const [activeRun, candidates, progress] = await Promise.all([
    activeRunId ? queryResearchRun(context.organizationId, activeRunId) : Promise.resolve(null),
    activeRunId ? queryResearchCandidates(context.organizationId, activeRunId) : Promise.resolve([]),
    activeRunId ? getResearchRunProgress(context.organizationId, activeRunId) : Promise.resolve(null),
  ]);
  const providerConfigured = resolveUsableProviderChain(process.env).length > 0;

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Prospecting"
        title="Research"
        description="Review sourced companies and contacts, run depth research in batches, then add good prospects into the lead + enrichment pipeline."
      />

      <div className="px-4 pt-4 sm:px-6"><CrmNav /></div>
      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-4">
          <CommandCockpit activeRun={activeRun} candidates={candidates} progress={progress} providerConfigured={providerConfigured} />
          {progress ? <RunProgressPanel initialProgress={progress} /> : null}

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Review queue</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Every sourced company and contact with its evidence, best fit, and next step.</p>
            </div>

            {activeRun ? (
              <ProspectGrid candidates={candidates} />
            ) : (
              <div className="rounded-xl border border-dashed border-hairline bg-surface p-10 text-center shadow-sm">
                <Radar className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                <div className="mt-2 text-sm font-semibold text-foreground">{icpOptions.length === 0 ? "No published ICPs" : "No run selected"}</div>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {icpOptions.length === 0
                    ? "You need a published ICP first — create one in the ICP Library, then start discovering."
                    : "Start a run from the panel on the right, or pick one from history to review its results."}
                </p>
              </div>
            )}
          </section>
        </main>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <ResearchRunRail runs={runs} activeRunId={activeRunId} icpOptions={icpOptions} providerConfigured={providerConfigured} />
          <RuntimeRail activeRun={activeRun} progress={progress} providerConfigured={providerConfigured} />
        </aside>
      </div>
    </WorkspaceFrame>
  );
}

function CommandCockpit({
  activeRun,
  candidates,
  progress,
  providerConfigured,
}: {
  activeRun: ResearchRunRow | null;
  candidates: ResearchCandidateRow[];
  progress: ResearchProgressPayload | null;
  providerConfigured: boolean;
}) {
  const reviewable = candidates.filter((candidate) => candidate.status === "DISCOVERED" || candidate.status === "DUPLICATE").length;
  const promoted = candidates.filter((candidate) => candidate.status === "PROMOTED" || candidate.hasLeadAssignment).length;
  const firstLeadId = candidates.find((candidate) => candidate.leadAssignmentId)?.leadAssignmentId ?? null;

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm">
      <div className="flex flex-col gap-4 border-b border-hairline p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 border border-primary/20 text-primary"><Search className="h-4 w-4" /></span>
            <span className="text-[11px] font-semibold  text-muted-foreground">This run</span>
            {activeRun ? <StatusBadge tone={runStatusMeta(activeRun.status).tone}>{runStatusMeta(activeRun.status).label}</StatusBadge> : null}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${providerConfigured ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-amber-500/10 border-amber-500/20 text-amber-600"}`}>{providerConfigured ? "Provider ready" : "Provider missing"}</span>
          </div>
          <h2 className="mt-2 truncate text-xl font-bold text-foreground">{activeRun ? `${activeRun.kind === "COMPANY" ? "Company" : "Contact"} discovery` : "No active run"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{activeRun ? `${activeRun.projectName} / ${activeRun.icpLabel}` : "Launch or select a run to review sourced prospects."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {firstLeadId ? (
            <Link href={`/v2/workspace/leads?leadAssignmentId=${firstLeadId}`} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/80 transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50">
              Open promoted leads <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <Link href="/v2/workspace/leads" className="inline-flex h-9 items-center gap-1 rounded-md border border-hairline px-3 text-xs font-semibold text-foreground bg-surface hover:bg-surface-raised transition-colors">
              Leads <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
      <div className="grid gap-0 divide-y divide-hairline sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <CockpitMetric icon={<Database className="h-4 w-4" />} label="Candidates" value={String(candidates.length)} detail={`${reviewable} reviewable`} />
        <CockpitMetric icon={<CheckCircle2 className="h-4 w-4" />} label="In pipeline" value={String(promoted)} detail="added to leads" />
        <CockpitMetric icon={<Clock3 className="h-4 w-4" />} label="Progress" value={progress ? `${progress.cursor}/${progress.totalQueries}` : activeRun ? `${activeRun.queryCursor}/${activeRun.queryCount}` : "0/0"} detail={progress ? `${progress.percent}% searched` : "-"} />
        <CockpitMetric icon={<Users className="h-4 w-4" />} label="Already known" value={activeRun ? String(activeRun.duplicateCount) : "0"} detail="seen before" />
      </div>
    </section>
  );
}

function RuntimeRail({ activeRun, progress, providerConfigured }: { activeRun: ResearchRunRow | null; progress: ResearchProgressPayload | null; providerConfigured: boolean }) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold  text-muted-foreground">Status</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">Run status</h3>
        </div>
        {activeRun ? <StatusBadge tone={runStatusMeta(activeRun.status).tone}>{runStatusMeta(activeRun.status).label}</StatusBadge> : null}
      </div>
      <div className="mt-4 space-y-2 text-xs text-muted-foreground">
        <RailLine label="Search provider" value={providerConfigured ? "Ready" : "Missing"} tone={providerConfigured ? "good" : "warn"} />
        <RailLine label="Working" value={progress ? `${progress.jobs.queued} queued / ${progress.jobs.running} running` : "-"} />
        <RailLine label="Steps" value={progress ? `${progress.runtime.chunks.succeeded}/${progress.runtime.chunks.total} done` : "-"} />
        <RailLine label="Next step" value={progress?.nextAction.label ?? "Launch a run"} tone={progress?.nextAction.kind === "failed" ? "warn" : "info"} />
      </div>
      {progress?.nextAction.detail ? <p className="mt-3 rounded-lg bg-secondary border border-hairline p-2.5 text-xs leading-5 text-muted-foreground">{progress.nextAction.detail}</p> : null}
    </section>
  );
}

function CockpitMetric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary border border-hairline text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold  text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function RailLine({ label, value, tone = "muted" }: { label: string; value: string; tone?: "good" | "warn" | "info" | "muted" }) {
  const cls = tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "info" ? "text-primary" : "text-foreground font-semibold";
  return <div className="flex items-center justify-between gap-3 rounded-md border border-hairline px-2.5 py-2 bg-background/50"><span className="text-muted-foreground">{label}</span><span className={`text-right font-semibold ${cls}`}>{value}</span></div>;
}

async function getContext() {
  try {
    return await requirePermission("ingestion.apply");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
