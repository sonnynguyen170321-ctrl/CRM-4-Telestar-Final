"use client";

import { X, Loader2, AlertTriangle, RotateCcw } from "lucide-react";

import { UnifiedLeadDrawer } from "./UnifiedLeadDrawer";
import { useLeadDrawer, type LeadDrawerSnapshot } from "./LeadDrawerProvider";

// P5: the drawer overlay. Renders instantly when a row opens — the snapshot header is
// shown immediately while the deep cards stream in from the API (skeleton -> hydrated).
// A failed fetch keeps the snapshot + offers retry. Backdrop / Esc / close button all
// dismiss without a page reload.

export function LeadDrawerHost({ inline = false }: { inline?: boolean }) {
  const { status, snapshot, model, campaigns, openById, retry, close } = useLeadDrawer();
  if (status === "closed") return null;

  if (inline) {
    return (
      <div className="flex h-full w-full flex-col">
        {status === "loaded" && model ? (
          <UnifiedLeadDrawer
            detail={model.detail}
            contactDetail={model.contactDetail}
            timeline={model.timeline}
            enrollments={model.enrollments}
            leadNotes={model.notes}
            leadTasks={model.tasks}
            assignableMembers={model.assignableMembers}
            campaigns={campaigns}
            onClose={close}
            onOpenLead={openById}
          />
        ) : (
          <DrawerShell snapshot={snapshot} status={status} onRetry={retry} onClose={close} />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close lead drawer"
        onClick={close}
        className="absolute inset-0 cursor-default bg-foreground/20 backdrop-blur-[1px]"
      />
      {status === "loaded" && model ? (
        <UnifiedLeadDrawer
          detail={model.detail}
          contactDetail={model.contactDetail}
          timeline={model.timeline}
          enrollments={model.enrollments}
          leadNotes={model.notes}
          leadTasks={model.tasks}
          assignableMembers={model.assignableMembers}
          campaigns={campaigns}
          onClose={close}
          onOpenLead={openById}
        />
      ) : (
        <DrawerShell snapshot={snapshot} status={status} onRetry={retry} onClose={close} />
      )}
    </div>
  );
}

function DrawerShell({
  snapshot, status, onRetry, onClose,
}: {
  snapshot: LeadDrawerSnapshot | null;
  status: "loading" | "error" | "closed" | "loaded";
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-3xl flex-col border-l border-border bg-white shadow-xl">
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-foreground">
                {snapshot?.contactName ?? "Lead"}
              </h2>
              <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">ICP assignment</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {[snapshot?.contactTitle, snapshot?.companyName].filter(Boolean).join(" at ") || snapshot?.companyName || "Loading…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/40 p-6">
        {status === "error" ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Couldn’t load the full detail.
            </div>
            <p className="mt-1 text-amber-700">The lead is still selected — retry to hydrate the cards.</p>
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
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading lead detail…
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-white p-4 shadow-sm">
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
