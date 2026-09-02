"use client";

import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

export default function V2ActivityRecapsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <WorkspaceFrame>
      <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-6">
        <div className="text-sm font-semibold text-red-900">
          Failed to load activity recaps
        </div>
        <p className="mt-2 text-sm text-red-700">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-xs text-red-400">{error.digest}</p>
        )}
        <button
          onClick={reset}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    </WorkspaceFrame>
  );
}
