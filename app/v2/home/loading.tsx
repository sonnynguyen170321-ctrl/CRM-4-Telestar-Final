import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

// D4: instant shell for the home command center. The route's Suspense boundary paints
// this immediately (on nav + initial stream) while the dashboard counts load, so the page
// never shows a blank frame. Layout mirrors the real page (header -> metric row -> panels)
// to avoid a jump when the data arrives.
export default function V2HomeLoading() {
  return (
    <WorkspaceFrame>
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-7 w-72 animate-pulse rounded bg-muted" />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-8 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-11 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </WorkspaceFrame>
  );
}
