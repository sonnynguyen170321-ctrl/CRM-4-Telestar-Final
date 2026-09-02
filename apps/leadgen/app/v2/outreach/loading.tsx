import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

// D4: instant shell for the outreach monitor (the heaviest read-model page). Mirrors the
// real layout — header, tab rail, metric grid, and the 3/2 activity + sender panels — so
// the skeleton -> data swap is seamless.
export default function V2OutreachLoading() {
  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border pb-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-full bg-muted" />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-8 w-12 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-5">
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-3">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="h-11 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-12 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceFrame>
  );
}
