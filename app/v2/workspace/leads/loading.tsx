import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

export default function V2LeadsLoading() {
  return (
    <WorkspaceFrame>
      <div className="rounded-lg border border-border bg-white p-6">
        <div className="h-5 w-40 rounded bg-muted" />
        <div className="mt-4 grid gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-10 rounded bg-muted" />
          ))}
        </div>
      </div>
    </WorkspaceFrame>
  );
}
