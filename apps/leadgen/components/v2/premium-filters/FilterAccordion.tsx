"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

interface FilterAccordionProps {
  title: string;
  activeCount?: number;
  onClear?: () => void;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export function FilterAccordion({
  title,
  activeCount = 0,
  onClear,
  children,
  defaultExpanded = false,
}: FilterAccordionProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);
  const panelId = React.useId();

  return (
    <div className="relative rounded-lg border border-border bg-surface shadow-sm transition-colors duration-200">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className={`flex min-h-10 w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${!isExpanded ? "rounded-lg" : "rounded-t-lg"} ${activeCount > 0 ? "pr-10" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {activeCount > 0 && !isExpanded ? (
            <span className="inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-accent/70 px-1 text-[10px] font-semibold text-primary">
              {activeCount}
            </span>
          ) : null}
        </div>
      </button>
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear?.();
          }}
          className="absolute right-2 top-2 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          title="Clear filters"
          aria-label={`Clear ${title} filters`}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
      {isExpanded ? (
        <div id={panelId} className="border-t border-border px-3 pb-3 pt-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}