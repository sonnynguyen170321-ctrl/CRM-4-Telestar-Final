import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type V2FilterPanelProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function V2FilterPanel({
  title = "Filters",
  description,
  actions,
  children,
  className,
}: V2FilterPanelProps) {
  return (
    <section className={cn("rounded-md border border-border bg-card p-4 shadow-xs", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}
