"use client";

import { FriendlyErrorState } from "@/components/shared/FriendlyErrorState";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

export default function V2LeadsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <WorkspaceFrame className="flex items-center justify-center">
      <FriendlyErrorState
        reason="generic"
        title="Unable to load the leads command center"
        message="The lead workspace could not load safely. Retry once; if it continues, ask the project owner to inspect the runtime or tenant logs."
        onRetry={reset}
      />
    </WorkspaceFrame>
  );
}