import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type FilterBarProps = {
  children: ReactNode;
  className?: string;
};

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border bg-background p-3 shadow-xs",
        className
      )}
    >
      {children}
    </div>
  );
}
