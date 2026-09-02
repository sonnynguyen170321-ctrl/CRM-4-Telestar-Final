import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type V2AuditSnapshotCardProps = {
  title: ReactNode;
  source?: ReactNode;
  confidence?: ReactNode;
  metadata?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function V2AuditSnapshotCard({
  title,
  source,
  confidence,
  metadata,
  action,
  children,
  className,
}: V2AuditSnapshotCardProps) {
  return (
    <section className={cn("rounded-md border border-border bg-card p-4 shadow-xs", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {source ? <p className="mt-1 text-xs text-muted-foreground">{source}</p> : null}
        </div>
        {confidence ? (
          <div className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground">
            {confidence}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-3 text-sm text-foreground">{children}</div> : null}
      {(metadata || action) ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="min-w-0">{metadata}</div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
