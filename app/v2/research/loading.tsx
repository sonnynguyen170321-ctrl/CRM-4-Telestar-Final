import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

// Skeleton for the force-dynamic research workspace so navigation shows structure immediately
// instead of a blank frame while the server resolves runs + candidates + progress.
export default function ResearchLoading() {
  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader eyebrow="Prospecting" title="Research" description="Loading your prospecting workspace…" />
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </aside>
        <main className="space-y-4">
          <div className="h-16 animate-pulse rounded-lg border border-border bg-card" />
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="h-12 animate-pulse border-b border-border bg-muted/40" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </WorkspaceFrame>
  );
}
