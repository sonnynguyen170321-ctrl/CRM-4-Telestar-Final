import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

// D4: instant shell for the campaign workspace (loads campaign detail, wizard leads, and
// the worker-health read-model). Mirrors the stage rail + metric grid + two-column panels.
export default function V2CampaignLoading() {
  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-2">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="h-7 w-56 animate-pulse rounded bg-muted" />
        </div>

        {/* stage rail */}
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-white p-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-md bg-muted" />
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

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
          <div className="space-y-5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-white p-5 shadow-sm">
                <div className="h-4 w-36 animate-pulse rounded bg-muted" />
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="h-12 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-white p-5 shadow-sm">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="mt-4 space-y-2">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="h-9 animate-pulse rounded bg-muted" />
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
