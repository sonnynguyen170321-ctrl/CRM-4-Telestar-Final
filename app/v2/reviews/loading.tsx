import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

export default function V2ReviewsLoading() {
  return (
    <WorkspaceFrame>
      <div className="rounded-lg border border-border bg-white p-6">
        <div className="h-5 w-48 rounded bg-muted" />
        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="h-80 rounded bg-muted" />
          <div className="h-80 rounded bg-muted" />
        </div>
      </div>
    </WorkspaceFrame>
  );
}
