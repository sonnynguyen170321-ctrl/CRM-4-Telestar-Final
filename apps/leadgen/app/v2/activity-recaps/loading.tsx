import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

export default function V2ActivityRecapsLoading() {
  return (
    <WorkspaceFrame>
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-5 w-36 rounded bg-muted" />
        <div className="h-48 rounded-lg bg-muted" />
      </div>
    </WorkspaceFrame>
  );
}
