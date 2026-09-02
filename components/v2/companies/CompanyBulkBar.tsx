"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Sparkles, UserPlus, X } from "lucide-react";

import {
  addCompaniesToLeadsAction,
  extractCompanyIntelligenceBulkAction,
} from "@/app/v2/crm/companies/actions";
import { useCompanySelection } from "./CompanySelection";
import { BulkActionBarShell } from "@/components/v2/shared/BulkActionBarShell";
import { getTaskTransitionView, TaskProgressBar } from "@/components/v2/shared/taskTransition";

const POLL_MS = 4000;
const MAX_TICKS = 225;
const TERMINAL = ["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"];

type IcpOption = { id: string; label: string };
type Run = {
  runId: string | null;
  processed: number;
  total: number;
  status: string;
};

export function CompanyBulkBar({ icpVersions = [] }: { icpVersions?: IcpOption[] }) {
  const { selected, count, clear } = useCompanySelection();
  const router = useRouter();
  const [enrichState, enrichAction, enrichPending] = useActionState(extractCompanyIntelligenceBulkAction, null);
  const [addState, addAction, addPending] = useActionState(addCompaniesToLeadsAction, null);
  const [run, setRun] = useState<Run | null>(null);
  const [stalled, setStalled] = useState(false);
  const [leadPanelOpen, setLeadPanelOpen] = useState(false);
  const [targetIcpVersionId, setTargetIcpVersionId] = useState("");
  const lastEnrichTs = useRef<number | null>(null);
  const lastAddTs = useRef<number | null>(null);

  useEffect(() => {
    if (!enrichState?.ok || enrichState.ts === lastEnrichTs.current) return;
    lastEnrichTs.current = enrichState.ts;
    clear();
    setRun({ runId: enrichState.runId, processed: 0, total: enrichState.count, status: "RUNNING" });
  }, [enrichState, clear]);

  useEffect(() => {
    if (!addState || addState.ts === lastAddTs.current) return;
    lastAddTs.current = addState.ts;
    if (addState.ok) {
      clear();
      // Legit post-action UI reset once the server action resolves (useActionState has no
      // completion callback). Converges immediately; not a render loop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLeadPanelOpen(false);
      setTargetIcpVersionId("");
      router.refresh();
    }
  }, [addState, clear, router]);

  useEffect(() => {
    if (!run || !run.runId) return;
    const runId = run.runId;
    let ticks = 0;
    let lastProcessed = -1; // only refresh the heavy table when new results actually land
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      ticks += 1;
      try {
        // Self-drive: POST drains this run's enrichment jobs inline (no worker required) and
        // returns the reconciled run counters - the bar advances from real data.
        const res = await fetch(`/v2/crm/companies/runs/${runId}/process`, { method: "POST" });
        if (res.ok) {
          const body = (await res.json()) as { view?: { run: { processedUnits: number; totalUnits: number; status: string } } };
          if (body.view) {
            const { processedUnits, totalUnits, status } = body.view.run;
            setRun((r) => (r ? { ...r, processed: processedUnits, total: totalUnits, status } : r));
            const terminal = TERMINAL.includes(status);
            if (processedUnits !== lastProcessed || terminal) {
              lastProcessed = processedUnits;
            }
            if (!terminal && processedUnits === 0 && ticks >= 4) setStalled(true);
            else if (processedUnits > 0) setStalled(false);
            if (terminal) clearInterval(id);
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

  if (count === 0 && !run && !addState?.ok) return null;

  const companyIds = Array.from(selected).join(",");
  const transition = getTaskTransitionView(run?.status ?? "QUEUED");
  const done = run ? transition.terminal : false;
  const pct = run && run.total > 0 ? Math.min(100, Math.round((run.processed / run.total) * 100)) : 0;
  const addMessage = addState?.message ?? null;

  return (
    <BulkActionBarShell mode="sticky">
      {run && count === 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-foreground">
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
              )}
              <span className="font-medium">
                {transition.label} {run.processed}/{run.total} compan{run.total === 1 ? "y" : "ies"}
              </span>
              {!done ? <span className="text-xs text-muted-foreground">updating as intelligence lands</span> : null}
            </div>
            <button type="button" onClick={() => setRun(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> {done ? "close" : "hide"}
            </button>
          </div>
          <TaskProgressBar percent={pct} tone={transition.tone} />
          {stalled && !done ? (
            <p className="text-xs text-amber-600">Still waiting on company enrichment. Leave this hidden, retry from the action bar, or start the worker if results do not advance.</p>
          ) : null}
        </div>
      ) : count > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">{count}</span>
              <span className="font-medium text-foreground">selected</span>
              <button type="button" onClick={clear} className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground">
                <X className="h-3.5 w-3.5" aria-hidden="true" /> clear
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setLeadPanelOpen((v) => !v)}
                disabled={icpVersions.length === 0}
                title={icpVersions.length === 0 ? "Publish an ICP first" : "Create or reuse ICP assignments for one ICP"}
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-primary/20 bg-accent px-3 text-sm font-semibold text-primary transition-colors hover:bg-accent/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" /> Create ICP assignments
              </button>
              <form action={enrichAction}>
                <input type="hidden" name="companyIds" value={companyIds} />
                <button
                  type="submit"
                  disabled={enrichPending}
                  className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-semibold text-background shadow-sm transition-colors hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {enrichPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                  {enrichPending ? "Queuing..." : `Extract intelligence (${count})`}
                </button>
              </form>
            </div>
          </div>

          {leadPanelOpen ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Create ICP assignments
                </span>
                <span className="text-xs text-muted-foreground">Scoring is the next step</span>
              </div>
              <form
                action={addAction}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <input type="hidden" name="companyIds" value={companyIds} />
                <select
                  name="targetIcpVersionId"
                  value={targetIcpVersionId}
                  onChange={(event) => setTargetIcpVersionId(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none ring-primary/20 transition focus:border-primary/20 focus:ring-4"
                >
                  <option value="">Select published ICP</option>
                  {icpVersions.map((icp) => (
                    <option key={icp.id} value={icp.id}>{icp.label}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setLeadPanelOpen(false)} className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-surface-raised">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addPending || !targetIcpVersionId}
                  className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground"
                >
                  {addPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                  Create {count}
                </button>
              </form>
              {addMessage ? <div className="mt-2 text-xs text-red-600">{addMessage}</div> : null}
            </div>
          ) : null}
        </div>
      ) : addState?.ok ? (
        <div className="flex items-center justify-between gap-4 text-sm text-foreground">
          <span className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Created ICP assignments for {addState.count} compan{addState.count === 1 ? "y" : "ies"}
          </span>
          <span className="text-xs text-muted-foreground">{addState.created} new / {addState.existing} reused</span>
        </div>
      ) : null}
    </BulkActionBarShell>
  );
}
