import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type V2TimelineItem = {
  id: string;
  title: ReactNode;
  timestamp?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
};

type V2TimelineProps = {
  items: V2TimelineItem[];
  emptyLabel?: ReactNode;
  className?: string;
};

const toneClassName: Record<NonNullable<V2TimelineItem["tone"]>, string> = {
  neutral: "bg-slate-300",
  success: "bg-[#16A34A]",
  warning: "bg-[#F59E0B]",
  danger: "bg-destructive",
  info: "bg-primary",
};

export function V2Timeline({ items, emptyLabel = "No activity yet.", className }: V2TimelineProps) {
  if (items.length === 0) {
    return (
      <div className={cn("rounded-md border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground", className)}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <ol className={cn("space-y-0", className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
          {index < items.length - 1 ? (
            <span className="absolute left-[8px] top-4 h-full w-px bg-border" aria-hidden="true" />
          ) : null}
          <span
            className={cn("relative mt-1 h-2.5 w-2.5 rounded-full", toneClassName[item.tone ?? "neutral"])}
            aria-hidden="true"
          />
          <div className="min-w-0 rounded-md border border-border bg-card px-3 py-2 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm font-medium text-foreground">{item.title}</div>
              {item.timestamp ? (
                <div className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.timestamp}</div>
              ) : null}
            </div>
            {item.description ? (
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</div>
            ) : null}
            {item.meta ? <div className="mt-2 text-xs text-muted-foreground">{item.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
