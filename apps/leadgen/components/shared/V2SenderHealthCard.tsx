import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type V2SenderHealthCardProps = {
  sender: ReactNode;
  health: "HEALTHY" | "WARNING" | "SUPPRESSED" | "READY" | "SCHEDULED";
  dailyCap?: ReactNode;
  sentToday?: ReactNode;
  warmup?: ReactNode;
  className?: string;
};

const healthClassName: Record<V2SenderHealthCardProps["health"], string> = {
  HEALTHY: "border-emerald-200 bg-emerald-50 text-emerald-800",
  READY: "border-blue-200 bg-blue-50 text-blue-800",
  SCHEDULED: "border-purple-200 bg-purple-50 text-purple-800",
  WARNING: "border-amber-200 bg-amber-50 text-amber-800",
  SUPPRESSED: "border-red-200 bg-red-50 text-red-800",
};

export function V2SenderHealthCard({
  sender,
  health,
  dailyCap,
  sentToday,
  warmup,
  className,
}: V2SenderHealthCardProps) {
  return (
    <section className={cn("rounded-md border border-border bg-card p-4 shadow-xs", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{sender}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Sender health and warmup limits</p>
        </div>
        <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", healthClassName[health])}>
          {health}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-border bg-background p-2">
          <dt className="text-muted-foreground">Daily cap</dt>
          <dd className="mt-1 font-semibold text-foreground">{dailyCap ?? "-"}</dd>
        </div>
        <div className="rounded-md border border-border bg-background p-2">
          <dt className="text-muted-foreground">Sent today</dt>
          <dd className="mt-1 font-semibold text-foreground">{sentToday ?? "-"}</dd>
        </div>
        <div className="rounded-md border border-border bg-background p-2">
          <dt className="text-muted-foreground">Warmup</dt>
          <dd className="mt-1 font-semibold text-foreground">{warmup ?? "-"}</dd>
        </div>
      </dl>
    </section>
  );
}
