"use client";

import { X, Loader2, AlertTriangle, RotateCcw } from "lucide-react";

import { CompanyDrawer } from "./CompanyDrawer";
import { useCompanyDrawer, type CompanyDrawerSnapshot } from "./CompanyDrawerProvider";

// Company drawer overlay. Opens instantly when a row is clicked — the snapshot header shows
// immediately while the heavy detail streams in from /v2/crm/companies/[id]/drawer (skeleton ->
// hydrated). A failed fetch keeps the snapshot + offers retry. Backdrop / Esc / close all dismiss
// without a page reload.
export function CompanyDrawerHost() {
  const { status, snapshot, detail, bestMatch, canOverride, retry, close } = useCompanyDrawer();
  if (status === "closed") return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close company drawer"
        onClick={close}
        className="absolute inset-0 cursor-default bg-foreground/20 backdrop-blur-[1px]"
      />
      {status === "loaded" && detail ? (
        <CompanyDrawer detail={detail} bestMatch={bestMatch} canOverride={canOverride} onClose={close} />
      ) : (
        <CompanyDrawerShell snapshot={snapshot} status={status} onRetry={retry} onClose={close} />
      )}
    </div>
  );
}

function CompanyDrawerShell({
  snapshot, status, onRetry, onClose,
}: {
  snapshot: CompanyDrawerSnapshot | null;
  status: "loading" | "error" | "closed" | "loaded";
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-4xl flex-col border-l border-hairline bg-surface shadow-2xl">
      <div className="shrink-0 border-b border-hairline px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-foreground">{snapshot?.name ?? "Company"}</h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{snapshot?.domain ?? "Loading…"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-secondary/40 p-6">
        {status === "error" ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm text-amber-700">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Couldn’t load the company detail.
            </div>
            <p className="mt-1">The company is still selected — retry to hydrate the panels.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading company detail…
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
                <div className="mb-3 h-3.5 w-32 animate-pulse rounded bg-muted" />
                <div className="space-y-2">
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
