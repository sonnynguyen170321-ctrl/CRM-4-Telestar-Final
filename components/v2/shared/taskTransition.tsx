import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, PauseCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type TaskTransitionTone = "neutral" | "info" | "success" | "warning" | "danger";

export type TaskTransitionView = {
  label: string;
  tone: TaskTransitionTone;
  icon: LucideIcon;
  terminal: boolean;
  inFlight: boolean;
};

const STATUS_META: Record<string, TaskTransitionView> = {
  QUEUED: { label: "Queued", tone: "info", icon: Clock3, terminal: false, inFlight: true },
  PENDING: { label: "Queued", tone: "info", icon: Clock3, terminal: false, inFlight: true },
  RUNNING: { label: "Running", tone: "info", icon: Loader2, terminal: false, inFlight: true },
  PROCESSING: { label: "Running", tone: "info", icon: Loader2, terminal: false, inFlight: true },
  RETRY_SCHEDULED: { label: "Needs attention", tone: "warning", icon: AlertTriangle, terminal: false, inFlight: false },
  SUCCEEDED: { label: "Completed", tone: "success", icon: CheckCircle2, terminal: true, inFlight: false },
  COMPLETED: { label: "Completed", tone: "success", icon: CheckCircle2, terminal: true, inFlight: false },
  PARTIAL: { label: "Partially completed", tone: "warning", icon: AlertTriangle, terminal: true, inFlight: false },
  FAILED: { label: "Failed", tone: "danger", icon: AlertTriangle, terminal: true, inFlight: false },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: PauseCircle, terminal: true, inFlight: false },
  ABANDONED: { label: "Cancelled", tone: "neutral", icon: PauseCircle, terminal: true, inFlight: false },
};

const TONE_CLASSES: Record<TaskTransitionTone, {
  surface: string;
  pill: string;
  iconTile: string;
  bar: string;
  dot: string;
  text: string;
}> = {
  neutral: {
    surface: "border-hairline bg-secondary text-muted-foreground",
    pill: "border-hairline bg-secondary text-muted-foreground",
    iconTile: "bg-secondary text-muted-foreground",
    bar: "bg-muted-foreground",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  },
  info: {
    surface: "border-primary/20 bg-accent text-primary",
    pill: "border-primary/20 bg-accent text-primary",
    iconTile: "bg-accent text-primary",
    bar: "bg-primary",
    dot: "bg-primary",
    text: "text-primary",
  },
  success: {
    surface: "border-emerald-200 bg-emerald-50 text-emerald-900",
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
    iconTile: "bg-emerald-100 text-emerald-700",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  warning: {
    surface: "border-amber-200 bg-amber-50 text-amber-900",
    pill: "border-amber-200 bg-amber-50 text-amber-700",
    iconTile: "bg-amber-100 text-amber-700",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
    text: "text-amber-700",
  },
  danger: {
    surface: "border-red-200 bg-red-50 text-red-900",
    pill: "border-red-200 bg-red-50 text-red-700",
    iconTile: "bg-red-100 text-red-700",
    bar: "bg-red-500",
    dot: "bg-red-500",
    text: "text-red-700",
  },
};

export function getTaskTransitionView(status: string | null | undefined): TaskTransitionView {
  const key = (status ?? "QUEUED").toUpperCase();
  return STATUS_META[key] ?? { label: humanizeTaskToken(key), tone: "neutral", icon: Clock3, terminal: false, inFlight: false };
}

export function taskToneClasses(tone: TaskTransitionTone) {
  return TONE_CLASSES[tone] ?? TONE_CLASSES.neutral;
}

export function TaskStatusPill({ status, className }: { status: string | null | undefined; className?: string }) {
  const view = getTaskTransitionView(status);
  const Icon = view.icon;
  const tone = taskToneClasses(view.tone);
  return (
    <span className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", tone.pill, className)}>
      <Icon className={cn("h-3.5 w-3.5", view.inFlight && "animate-spin")} aria-hidden="true" />
      {view.label}
    </span>
  );
}

export function TaskProgressBar({ percent, tone, className }: { percent: number; tone: TaskTransitionTone; className?: string }) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none", taskToneClasses(tone).bar)}
        style={{ width: `${safePercent}%` }}
      />
    </div>
  );
}

export function humanizeTaskToken(value: string | null | undefined): string {
  if (!value) return "Not started";
  const key = value.toUpperCase();
  const known: Record<string, string> = {
    COMPANY_QUALIFIED_NEEDS_CONTACT: "Needs contact",
    NOT_SCORED: "Not scored",
    NEEDS_REVIEW: "Needs review",
    UNQUALIFIED: "Unqualified",
    QUALIFIED: "Qualified",
    NO_WEBSITE: "No website",
    NOT_RUN: "Not enriched yet",
    LEAD_ASSIGNMENT_UPSERT: "Create ICP assignments",
    ICP_SCORE: "Score against ICP",
    IDENTITY_MATCH: "Match identity",
    COMPANY_ENRICHMENT: "Enrich company",
    INGESTION_PARSE: "Parse file",
    INGESTION_NORMALIZE: "Normalize rows",
  };
  if (known[key]) return known[key];
  return key
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
