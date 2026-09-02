import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  trend?: ReactNode;
  className?: string;
};

export function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  trend,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-sm ring-1 ring-foreground/5 transition-shadow hover:shadow-md",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-normal text-muted-foreground">
            {label}
          </p>
          <div className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
            {value}
          </div>
        </div>
        {Icon ? (
          <div className="rounded-md border bg-muted/50 p-2 text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        ) : null}
      </div>
      {description || trend ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs leading-5 text-muted-foreground">
          {description ? <div>{description}</div> : <span />}
          {trend ? <div className="shrink-0 font-medium">{trend}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
