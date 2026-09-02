import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FilterChip = {
  key: string;
  label: ReactNode;
  onRemove?: () => void;
};

type FilterChipBarProps = {
  chips: FilterChip[];
  onClearAll?: () => void;
  className?: string;
};

export function FilterChipBar({
  chips,
  onClearAll,
  className,
}: FilterChipBarProps) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-xs font-medium text-muted-foreground">
        Active filters
      </span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs text-foreground"
        >
          {chip.label}
          {chip.onRemove ? (
            <button
              type="button"
              onClick={chip.onRemove}
              className="rounded-sm text-muted-foreground hover:text-foreground"
              aria-label="Remove filter"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ))}
      {onClearAll ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}
