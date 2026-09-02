"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, DatabaseZap, Loader2, Send, Sparkles, Target, UploadCloud } from "lucide-react";

import { extractCompanyIntelligenceBulkAction } from "@/app/v2/crm/companies/actions";
import { notifyV2 } from "@/components/v2/notifications/notificationClient";

// The SDR pipeline strip on the cockpit: the full flow Import -> Enrich -> Score -> Review ->
// Outreach, each a real destination with a LIVE count (rendered only when a real number is passed,
// never invented). The Enrich stage runs inline: it calls the SAME bulk enrichment action the
// Companies workspace uses and self-drives the run to completion, so the operator advances the
// pipeline without route-hopping. No new business logic; no scoring queued from here.

const POLL_MS = 4000;
const MAX_TICKS = 225;
const TERMINAL = ["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"];

type Stage = { key: string; title: string; href: string; icon: ReactNode; count?: number | null };
type Run = { runId: string | null; processed: number; total: number; status: string };

export type PipelineStageCounts = {
  enrichCount?: number | null;
  scoreCount?: number | null;
  reviewCount?: number | null;
  enrichCompanyIds?: string[];
};

export function PipelineFlowWidget({ enrichCount, scoreCount, reviewCount, enrichCompanyIds = [] }: PipelineStageCounts = {}) {
  const router = useRouter();
  const [enrichState, enrichAction, enrichPending] = useActionState(extractCompanyIntelligenceBulkAction, null);
  const [run, setRun] = useState<Run | null>(null);
  const lastTs = useRef<number | null>(null);
  const enrichFormRef = useRef<HTMLFormElement>(null);

  const batch = enrichCompanyIds.slice(0, 200);
  const canEnrich = batch.length > 0;

  // Kick the self-drive once the bulk action returns a run.
  useEffect(() => {
    if (!enrichState?.ok || enrichState.ts === lastTs.current) return;
    lastTs.current = enrichState.ts;
    setRun({ runId: enrichState.runId, processed: 0, total: enrichState.count, status: "RUNNING" });
  }, [enrichState]);

  // Self-drive: POST drains this run's enrichment jobs inline (no worker required) and returns the
  // reconciled counters, exactly like the Companies bulk bar. On completion, notify + refresh counts.
  useEffect(() => {
    if (!run || !run.runId) return;
    const runId = run.runId;
    let ticks = 0;
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      ticks += 1;
      try {
        const res = await fetch(`/v2/crm/companies/runs/${runId}/process`, { method: "POST" });
        if (res.ok) {
          const body = (await res.json()) as { view?: { run: { processedUnits: number; totalUnits: number; status: string } } };
          if (body.view) {
            const { processedUnits, totalUnits, status } = body.view.run;
            setRun((r) => (r ? { ...r, processed: processedUnits, total: totalUnits, status } : r));
            if (TERMINAL.includes(status)) {
              clearInterval(id);
              notifyV2({
                type: "enrichment.completed",
                kind: status === "FAILED" ? "error" : "success",
                title: status === "FAILED" ? "Enrichment run failed" : `Enriched ${processedUnits} compan${processedUnits === 1 ? "y" : "ies"}`,
                description: status === "FAILED" ? "Some companies did not enrich — open the workspace to retry." : "Intelligence is ready. Score them against an ICP next.",
                href: "/v2/crm/companies",
                actionLabel: "Open companies",
              });
              router.refresh();
            }
          }
        }
      } catch {
        /* transient; keep polling */
      } finally {
        inFlight = false;
      }
      if (ticks >= MAX_TICKS) clearInterval(id);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [run, router]);

  const running = run !== null && !TERMINAL.includes(run.status);
  const pct = run && run.total > 0 ? Math.min(100, Math.round((run.processed / run.total) * 100)) : 0;

  const stages: Stage[] = [
    { key: "import", title: "Import", href: "/v2/ingestion/uploads", icon: <UploadCloud className="h-4 w-4" /> },
    { key: "enrich", title: "Enrich", href: "/v2/crm/companies", icon: <DatabaseZap className="h-4 w-4" />, count: enrichCount ?? null },
    { key: "score", title: "Score", href: "/v2/workspace/leads", icon: <Sparkles className="h-4 w-4" />, count: scoreCount ?? null },
    { key: "review", title: "Review", href: "/v2/reviews", icon: <ClipboardCheck className="h-4 w-4" />, count: reviewCount ?? null },
    { key: "outreach", title: "Outreach", href: "/v2/outreach/campaigns", icon: <Send className="h-4 w-4" /> },
  ];

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Target className="h-4 w-4 text-primary" /> Pipeline</h3>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Your flow</span>
      </div>
      <div className="flex items-stretch gap-1.5 overflow-x-auto">
        {stages.map((stage, i) => (
          <div key={stage.key} className="flex min-w-0 flex-1 items-center gap-1.5">
            <Link
              href={stage.href}
              className="group flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-border bg-background p-3 transition-all hover:border-primary/50 hover:bg-accent hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">{stage.icon}</span>
                {typeof stage.count === "number" && stage.count > 0 ? (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">{stage.count}</span>
                ) : null}
              </div>
              <span className="text-xs font-semibold text-foreground">{stage.title}</span>
              {/* Inline "continue" affordance on the Enrich stage — run the existing bulk action here. */}
              {stage.key === "enrich" ? (
                run ? (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary">
                    {running ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                    {running ? `Enriching ${run.processed}/${run.total}` : `Enriched ${run.processed}/${run.total}`}
                  </span>
                ) : canEnrich ? (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); enrichFormRef.current?.requestSubmit(); }}
                    disabled={enrichPending}
                    className="mt-0.5 inline-flex w-fit items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 disabled:opacity-60"
                  >
                    {enrichPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3 w-3" aria-hidden="true" />}
                    {enrichPending ? "Starting…" : `Enrich ${batch.length}`}
                  </button>
                ) : null
              ) : null}
            </Link>
            {i < stages.length - 1 ? <span className="shrink-0 text-muted-foreground/40">→</span> : null}
          </div>
        ))}
      </div>
      {run ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${running ? "bg-primary" : "bg-emerald-500"} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {/* Off-screen form so the inline button reuses the exact server action + arg contract. */}
      <form ref={enrichFormRef} action={enrichAction} className="hidden">
        <input type="hidden" name="companyIds" value={batch.join(",")} />
      </form>
    </div>
  );
}
