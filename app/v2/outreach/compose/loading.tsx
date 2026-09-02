import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

// D4: instant shell for compose (loads the lead detail + company intelligence). Mirrors the
// editor + readiness/context two-column layout.
export default function V2ComposeLoading() {
  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-2">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-16 animate-pulse rounded bg-muted" />
              <div className="h-16 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-48 animate-pulse rounded bg-muted" />
            <div className="h-9 w-32 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-white p-4 shadow-sm">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="h-8 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceFrame>
  );
}
