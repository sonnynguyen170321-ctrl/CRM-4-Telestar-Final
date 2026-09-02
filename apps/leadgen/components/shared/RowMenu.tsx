"use client";

import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The one shared kebab row menu (Instantly-style). Every list row uses THIS — no page-local
// clones. Items are plain callbacks; destructive items render red and should route through
// ConfirmDialog in the caller.

export type RowMenuItem =
  | { kind: "item"; label: string; icon?: ReactNode; onSelect: () => void; destructive?: boolean; disabled?: boolean }
  | { kind: "separator" };

export function RowMenu({ items, label = "Row actions" }: { items: RowMenuItem[]; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {items.map((item, i) =>
          item.kind === "separator" ? (
            <DropdownMenuSeparator key={`sep-${i}`} />
          ) : (
            <DropdownMenuItem
              key={item.label}
              disabled={item.disabled}
              onSelect={(e) => {
                e.preventDefault();
                item.onSelect();
              }}
              className={item.destructive ? "text-red-600 focus:bg-red-50 focus:text-red-700" : undefined}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
