"use client";

import * as React from "react";
import { Check, ChevronRight } from "lucide-react";

import { buildServedVerticalTree, type ServedVerticalTreeNode } from "@/lib/v2/scoring/rules/dictionaries/servedVertical";

// W5: the shared hierarchical industry-&-vertical filter tree. One implementation used by BOTH the
// companies and leads FILTERS panels so the affordance is identical across surfaces. Native <details>
// for collapse (no JS), toggle handlers own selection. `selected`/`onToggle` are the multi-select
// contract (the parent maps them to comma-encoded URL params via add/removeFilter).

function flattenSubtree(node: ServedVerticalTreeNode, depth: number): Array<{ node: ServedVerticalTreeNode; depth: number }> {
  const out: Array<{ node: ServedVerticalTreeNode; depth: number }> = [];
  for (const child of node.children) {
    out.push({ node: child, depth });
    out.push(...flattenSubtree(child, depth + 1));
  }
  return out;
}

function countSelected(node: ServedVerticalTreeNode, selected: Set<string>): number {
  let n = selected.has(node.key) ? 1 : 0;
  for (const c of node.children) n += countSelected(c, selected);
  return n;
}

export function ServedVerticalTree({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (key: string) => void;
}) {
  const sel = new Set(selected);
  const tree = React.useMemo(() => buildServedVerticalTree(), []);

  return (
    <div className="max-h-[320px] space-y-0.5 overflow-y-auto pr-1">
      {tree.map((sector) => {
        const count = countSelected(sector, sel);
        const rows: Array<{ node: ServedVerticalTreeNode; depth: number; all: boolean }> = [
          { node: sector, depth: 0, all: true },
          ...flattenSubtree(sector, 1).map((r) => ({ ...r, all: false })),
        ];
        return (
          <details key={sector.key} open={count > 0} className="group/sector">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
              <span className="truncate">{sector.label}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {count > 0 ? (
                  <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-primary">{count}</span>
                ) : null}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-open/sector:rotate-90" aria-hidden="true" />
              </span>
            </summary>
            <div className="space-y-0.5 pb-1.5">
              {rows.map(({ node, depth, all }) => {
                const isSel = sel.has(node.key);
                return (
                  <button
                    key={node.key}
                    type="button"
                    onClick={() => onToggle(node.key)}
                    aria-pressed={isSel}
                    style={{ paddingLeft: `${depth * 12 + 6}px` }}
                    className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                      isSel ? "font-semibold text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                        isSel ? "border-primary bg-primary text-white" : "border-border"
                      }`}
                    >
                      {isSel ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : null}
                    </span>
                    <span className="truncate">{all ? `All ${node.label}` : node.label}</span>
                  </button>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
