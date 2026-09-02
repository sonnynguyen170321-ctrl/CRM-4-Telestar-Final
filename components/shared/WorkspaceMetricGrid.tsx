import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type WorkspaceMetricGridProps = {
  children: ReactNode;
  className?: string;
};

export function WorkspaceMetricGrid({
  children,
  className,
}: WorkspaceMetricGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}
