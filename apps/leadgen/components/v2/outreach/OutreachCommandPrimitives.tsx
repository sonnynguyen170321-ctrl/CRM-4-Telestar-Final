import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, MinusCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type OutreachTone = "neutral" | "blue" | "green" | "amber" | "red" | "slate";

const toneStyles: Record<OutreachTone, { soft: string; text: string; border: string; dot: string }> = {
  neutral: {
    soft: "bg-card",
    text: "text-foreground",
    border: "border-border",
    dot: "bg-foreground",
  },
  blue: {
    soft: "bg-accent",
    text: "text-primary",
    border: "border-primary/20",
    dot: "bg-primary",
  },
  green: {
    soft: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  amber: {
    soft: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  red: {
    soft: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
  },
  slate: {
    soft: "bg-muted",
    text: "text-foreground",
    border: "border-border",
    dot: "bg-foreground",
  },
};

export function OutreachPill({
  tone = "slate",
  children,
  icon: Icon,
  className,
}: {
  tone?: OutreachTone;
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  const toneClass = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold",
        toneClass.soft,
        toneClass.text,
        toneClass.border,
        className
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : <span className={cn("h-1.5 w-1.5 rounded-full", toneClass.dot)} />}
      {children}
    </span>
  );
}

export const StatusPill = OutreachPill;

import { BentoMetricCard } from "@/components/shared/BentoPrimitives";

export function OutreachMetricTile({
  label,
  value,
  description,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  tone?: OutreachTone;
  icon?: ComponentType<{ className?: string }>;
}) {
  const toneToColor: Record<string, "blue" | "indigo" | "purple" | "amber" | "teal" | "green" | "rose" | "pink" | "neutral"> = {
    neutral: "neutral",
    green: "green",
    amber: "amber",
    blue: "blue",
    rose: "rose",
  };
  return (
    <BentoMetricCard
      label={label}
      value={value as number | string}
      icon={Icon}
      color={toneToColor[tone] || "neutral"}
      className="!p-4"
    />
  );
}

export { PremiumBentoCard as OutreachPanel } from "@/components/shared/BentoPrimitives";

export function ChecklistRow({
  ok,
  label,
  detail,
  neutral = false,
}: {
  ok: boolean;
  label: ReactNode;
  detail?: ReactNode;
  neutral?: boolean;
}) {
  const Icon = neutral ? MinusCircle : ok ? CheckCircle2 : AlertTriangle;
  const tone = neutral ? "text-muted-foreground" : ok ? "text-emerald-600" : "text-amber-600";
  return (
    <li className="flex gap-3 rounded-xl border border-hairline bg-surface-raised px-3 py-2.5">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {detail ? <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</div> : null}
      </div>
    </li>
  );
}

export type ReadinessItem = {
  ok: boolean;
  label: ReactNode;
  detail?: ReactNode;
  neutral?: boolean;
};

export function ReadinessChecklist({
  items,
  footer,
  className,
}: {
  items: ReadinessItem[];
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <ChecklistRow key={index} ok={item.ok} label={item.label} detail={item.detail} neutral={item.neutral} />
        ))}
      </ul>
      {footer ? <div className="mt-3 text-xs leading-5 text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

export function InsightStrip({
  children,
  tone = "neutral",
  icon: Icon,
  className,
}: {
  children: ReactNode;
  tone?: OutreachTone;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  const toneClass = toneStyles[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm leading-6",
        tone === "neutral" ? "border-border bg-card text-muted-foreground" : [toneClass.border, toneClass.soft, toneClass.text],
        className
      )}
    >
      {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ActionQueue({
  items,
  emptyLabel = "No action needed",
}: {
  items: Array<{ label: ReactNode; detail?: ReactNode; tone?: OutreachTone; action?: ReactNode }>;
  emptyLabel?: ReactNode;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-700">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const tone = toneStyles[item.tone ?? "amber"];
        return (
          <div key={index} className={cn("rounded-md border px-3 py-2", tone.border, tone.soft)}>
            <div className={cn("text-sm font-semibold", tone.text)}>{item.label}</div>
            {item.detail ? <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.detail}</div> : null}
            {item.action ? <div className="mt-2">{item.action}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function DenseEntityTable({
  children,
  minWidth = "860px",
  className,
}: {
  children: ReactNode;
  minWidth?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function DataState({
  icon: Icon = Circle,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline bg-surface-raised text-muted-foreground shadow-sm">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
      {description ? <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export const EmptyActionState = DataState;

export { BentoGrid, PremiumBentoCard as BentoCard } from "@/components/shared/BentoPrimitives";
