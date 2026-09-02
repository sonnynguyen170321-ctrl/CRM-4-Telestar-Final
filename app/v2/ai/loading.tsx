import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

// Skeleton shown during navigation so the surface has structure instead of a blank frame.
export default function Loading() {
  return (
    <WorkspaceFrame>
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-muted/70" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="h-11 animate-pulse border-b border-border bg-muted/40" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceFrame>
  );
}
