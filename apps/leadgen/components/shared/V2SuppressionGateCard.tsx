import { CheckCircle2, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type GateRow = {
  id: string;
  label: ReactNode;
  passed: boolean;
  detail?: ReactNode;
};

type V2SuppressionGateCardProps = {
  title?: ReactNode;
  rows: GateRow[];
  className?: string;
};

export function V2SuppressionGateCard({
  title = "Suppression gate",
  rows,
  className,
}: V2SuppressionGateCardProps) {
  const allPassed = rows.length > 0 && rows.every((row) => row.passed);

  return (
    <section className={cn("rounded-md border border-border bg-card p-4 shadow-xs", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span
          className={cn(
            "rounded-md border px-2 py-1 text-xs font-medium",
            allPassed
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          )}
        >
          {allPassed ? "Ready" : "Blocked"}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => {
          const Icon = row.passed ? CheckCircle2 : XCircle;
          return (
            <div key={row.id} className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
              <Icon
                className={cn("mt-0.5 h-4 w-4", row.passed ? "text-[#16A34A]" : "text-destructive")}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{row.label}</div>
                {row.detail ? <div className="mt-0.5 text-xs text-muted-foreground">{row.detail}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
