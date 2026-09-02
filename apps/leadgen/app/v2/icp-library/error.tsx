"use client";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Button } from "@/components/ui/button";

export default function V2IcpLibraryError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <WorkspaceFrame className="flex items-center justify-center">
      <div className="max-w-lg rounded-lg border border-border bg-white p-6 text-center">
        <div className="text-sm font-semibold text-foreground">
          Unable to load this V2 view
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          The data could not be loaded safely. Please retry or contact the
          project owner if this continues.
        </p>
        <Button type="button" className="mt-4" onClick={() => reset()}>
          Retry
        </Button>
      </div>
    </WorkspaceFrame>
  );
}
