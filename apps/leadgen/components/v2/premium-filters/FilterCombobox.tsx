"use client";

import * as React from "react";
import { Search, Check, Ban, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface FilterOption {
  id: string;
  label: string;
  count?: number;
}

interface FilterComboboxProps {
  options: FilterOption[];
  includes: string[];
  excludes: string[];
  onInclude: (id: string) => void;
  onExclude: (id: string) => void;
  onRemove: (id: string) => void;
  placeholder?: string;
  allowExclude?: boolean;
}

export function FilterCombobox({
  options,
  includes,
  excludes,
  onInclude,
  onExclude,
  onRemove,
  placeholder = "Search...",
  allowExclude = true,
}: FilterComboboxProps) {
  const [query, setQuery] = React.useState("");

  const filteredOptions = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);

  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <span className="sr-only">Filter options</span>
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-9 border-border bg-muted/50 pl-8 text-xs focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </label>

      <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
        {filteredOptions.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">
            No results found.
          </div>
        ) : (
          filteredOptions.map((option) => {
            const isIncluded = includes.includes(option.id);
            const isExcluded = excludes.includes(option.id);
            const isSelected = isIncluded || isExcluded;
            const labelClass = isIncluded
              ? "font-medium text-emerald-700"
              : isExcluded
                ? "font-medium text-rose-700 line-through"
                : "text-foreground";

            return (
              <div
                key={option.id}
                className={`flex min-h-10 items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${isSelected ? "bg-muted/40" : "hover:bg-muted/40"}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  onClick={() => {
                    if (isSelected) onRemove(option.id);
                    else onInclude(option.id);
                  }}
                  aria-pressed={isSelected}
                  title={isSelected ? "Remove filter" : "Include filter"}
                >
                  <span className={`truncate ${labelClass}`}>{option.label}</span>
                  {option.count !== undefined && !isSelected ? (
                    <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                      {option.count}
                    </span>
                  ) : null}
                </button>

                {isSelected ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
                    onClick={() => onRemove(option.id)}
                    title="Remove"
                    aria-label={`Remove ${option.label}`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                      onClick={() => onInclude(option.id)}
                      title="Include"
                      aria-label={`Include ${option.label}`}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    {allowExclude ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-rose-500 hover:bg-rose-100 hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500/30"
                        onClick={() => onExclude(option.id)}
                        title="Exclude"
                        aria-label={`Exclude ${option.label}`}
                      >
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}