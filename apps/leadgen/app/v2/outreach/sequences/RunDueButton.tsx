"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Play } from "lucide-react";

export function RunDueButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:bg-primary"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Play className="h-4 w-4" aria-hidden="true" />
      )}
      {pending ? "Running..." : "Run due steps"}
    </button>
  );
}
