import { type ReactNode, type ComponentType } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Premium Metric Card for Dashboards (unified PremiumMetricCard + OutreachMetricTile)
 */
export function BentoMetricCard({
  label,
  value,
  trendPct,
  icon: Icon,
  color = "blue",
  className,
}: {
  label: string;
  value: number | string;
  trendPct?: number;
  icon?: LucideIcon | ComponentType<{ className?: string }>;
  color?: "blue" | "indigo" | "purple" | "amber" | "teal" | "green" | "rose" | "pink" | "neutral";
  className?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 ring-blue-100/50",
    indigo: "bg-indigo-50 text-indigo-600 ring-indigo-100/50",
    purple: "bg-purple-50 text-purple-600 ring-purple-100/50",
    amber: "bg-amber-50 text-amber-600 ring-amber-100/50",
    teal: "bg-teal-50 text-teal-600 ring-teal-100/50",
    green: "bg-emerald-50 text-emerald-600 ring-emerald-100/50",
    rose: "bg-rose-50 text-rose-600 ring-rose-100/50",
    pink: "bg-pink-50 text-pink-600 ring-pink-100/50",
    neutral: "bg-slate-50 text-slate-600 ring-slate-100/50",
  };
  const iconStyle = colorMap[color] || colorMap.blue;

  const isUp = (trendPct ?? 0) >= 0;
  const trendColor = isUp ? "text-emerald-600" : "text-rose-600";
  const trendIcon = isUp ? "↑" : "↓";

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5 text-center shadow-sm ring-1 ring-slate-900/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md",
        className
      )}
    >
      {Icon && (
        <div
          className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl ring-1 ${iconStyle} transition-transform duration-300 group-hover:scale-110 group-hover:shadow-sm`}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="text-2xl font-bold tracking-tight text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="mt-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      {trendPct !== undefined && (
        <div className={`mt-3 text-[11px] font-medium ${trendColor}`}>
          {trendIcon} {Math.abs(trendPct)}% <span className="text-muted-foreground/60 font-normal">vs last 30 days</span>
        </div>
      )}
    </div>
  );
}

/**
 * Premium Bento Card for Panels and Sections (unified OutreachPanel + BentoCard)
 */
export function PremiumBentoCard({
  title,
  description,
  actions,
  children,
  colSpan = 1,
  rowSpan = 1,
  className,
  contentClassName,
  gradient = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  colSpan?: 1 | 2 | 3 | 4;
  rowSpan?: 1 | 2 | 3;
  className?: string;
  contentClassName?: string;
  gradient?: boolean;
}) {
  const colClasses = {
    1: "md:col-span-1",
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
  };
  const rowClasses = {
    1: "row-span-1",
    2: "row-span-2",
    3: "row-span-3",
  };

  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card/60 backdrop-blur-xl shadow-sm overflow-hidden flex flex-col transition-shadow hover:shadow-md",
        colClasses[colSpan],
        rowClasses[rowSpan],
        gradient && "bg-gradient-to-br from-background to-muted/20",
        className
      )}
    >
      {(title || description || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 bg-background/50 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-bold text-foreground tracking-tight">{title}</h2>}
            {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn("flex-1", contentClassName)}>{children}</div>
    </section>
  );
}

export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 auto-rows-min gap-5", className)}>
      {children}
    </div>
  );
}
