import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

export default function V2FeedbackLoading() {
  return (
    <WorkspaceFrame>
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-7 w-40 rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-muted" />
      </div>
    </WorkspaceFrame>
  );
}
