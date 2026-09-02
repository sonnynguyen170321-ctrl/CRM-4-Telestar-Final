import * as React from "react";
import { Button } from "@/components/ui/button";

interface FilterSidebarProps {
  children: React.ReactNode;
  activeCount: number;
  onClearAll: () => void;
  className?: string;
}

export function FilterSidebar({
  children,
  activeCount,
  onClearAll,
  className = "",
}: FilterSidebarProps) {
  return (
    <div className={`flex flex-col w-[280px] shrink-0 border border-hairline bg-surface rounded-xl shadow-sm h-full overflow-hidden m-3 ${className}`}>
      <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-hairline bg-surface-raised">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold uppercase tracking-wider text-foreground">Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-bold text-primary">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear All
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scrollbar-hide">
        {children}
      </div>
    </div>
  );
}
