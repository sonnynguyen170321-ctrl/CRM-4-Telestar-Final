import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function BulkActionBarShell({
  children,
  mode = "fixed",
  className,
}: {
  children: ReactNode;
  mode?: "fixed" | "sticky";
  className?: string;
}) {
  if (mode === "sticky") {
    return (
      <div className={cn("sticky bottom-4 z-20 mx-auto mt-4 w-full max-w-3xl", className)}>
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 shadow-sm">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5", className)}>
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-3 shadow-sm">
        {children}
      </div>
    </div>
  );
}
