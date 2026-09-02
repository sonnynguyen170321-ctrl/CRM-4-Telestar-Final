import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageToolbarProps = {
  children: ReactNode;
  className?: string;
};

export function PageToolbar({ children, className }: PageToolbarProps) {
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
