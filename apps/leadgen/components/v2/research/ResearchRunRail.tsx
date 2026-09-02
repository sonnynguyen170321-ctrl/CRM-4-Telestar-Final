"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Radar } from "lucide-react";

import { ProspectBuilderModal, type ResearchIcpOption } from "@/components/v2/research/ProspectBuilderModal";
import { runStatusMeta } from "@/components/v2/research/researchLabels";
import { StatusBadge } from "@/components/shared/statusBadges";
import type { ResearchRunRow } from "@/lib/v2/research/queryResearch";

export function ResearchRunRail({
  runs,
  activeRunId,
  icpOptions,
  providerConfigured,
}: {
  runs: ResearchRunRow[];
  activeRunId: string | null;
  icpOptions: ResearchIcpOption[];
  providerConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <aside className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prospect builder</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">Launch or revisit runs</h3>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${providerConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{providerConfigured ? "Ready" : "No provider"}</span>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={icpOptions.length === 0}
        className="mt-3 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> New run
      </button>
      {icpOptions.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Publish an ICP in the <Link href="/v2/icp-library" className="font-medium text-primary hover:text-primary">ICP Library</Link> to start.</p>
      ) : null}

      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Run history</div>
          <span className="text-[11px] text-muted-foreground">{runs.length} recent</span>
        </div>
        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            <Radar className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-1">No runs yet.</p>
          </div>
        ) : (
          <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/v2/research?runId=${run.id}`}
                  className={`block rounded-lg border p-2.5 transition-colors ${run.id === activeRunId ? "border-primary/20 bg-accent/60" : "border-border bg-white hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{run.kind === "COMPANY" ? "Companies" : "Contacts"}</span>
                    <StatusBadge tone={runStatusMeta(run.status).tone} className="shrink-0 text-[10px]">{runStatusMeta(run.status).label}</StatusBadge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{run.icpLabel}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{run.queryCursor}/{run.queryCount} queries</span>
                    <span className="font-semibold text-emerald-600">{run.discoveredCount} new</span>
                    <span className="text-amber-600">{run.duplicateCount} known</span>
                  </div>
                  {run.errorMessage ? <p className="mt-1 line-clamp-2 text-[11px] text-red-600">{run.errorMessage}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProspectBuilderModal open={open} onClose={() => setOpen(false)} icpOptions={icpOptions} providerConfigured={providerConfigured} />
    </aside>
  );
}
