"use client";

import { RefreshCw } from "lucide-react";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Button } from "@/components/ui/button";

export default function V2CompaniesError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <WorkspaceFrame className="flex items-center justify-center">
      <div className="max-w-xl rounded-lg border border-red-200 bg-white p-6 text-center">
        <div className="text-sm font-semibold text-red-900">
          Company intelligence failed to load
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "Refresh the read-only view and try again."}
        </p>
        <Button type="button" className="mt-5" onClick={reset}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Retry
        </Button>
      </div>
    </WorkspaceFrame>
  );
}
