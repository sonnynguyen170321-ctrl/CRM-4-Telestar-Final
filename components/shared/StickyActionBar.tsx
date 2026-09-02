import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StickyActionBarProps = {
  children: ReactNode;
  className?: string;
};

export function StickyActionBar({ children, className }: StickyActionBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 border-t bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}
