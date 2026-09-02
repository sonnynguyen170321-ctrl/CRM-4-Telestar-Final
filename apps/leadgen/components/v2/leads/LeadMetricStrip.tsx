import Link from "next/link";
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  XCircle,
  CircleDashed,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";

import type { LeadWorkspaceFilters, LeadWorkspaceMetrics } from "@/lib/v2/crm";
import { cn } from "@/lib/utils";

type Tone = "blue" | "emerald" | "amber" | "violet" | "red" | "slate" | "teal";

type MetricDef = {
  key: string;
  label: string;
  value: number;
  icon: LucideIcon;
  tone: Tone;
  // The filter mutation this card applies when clicked. undefined value = clear.
  param: "qualification" | "workflowStatus" | "__all__";
  paramValue?: string;
  active: boolean;
};

// Status-semantic tones (each maps to a qualification/workflow bucket) — hue is meaningful, so it
// stays; dark variants give full light/dark parity.
const toneStyles: Record<
  Tone,
  { chip: string; ring: string; value: string }
> = {
  blue: { chip: "bg-accent text-primary ring-primary/20", ring: "ring-primary/60", value: "text-foreground" },
  emerald: { chip: "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25", ring: "ring-emerald-500/60", value: "text-emerald-700 dark:text-emerald-300" },
  amber: { chip: "bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/25", ring: "ring-amber-500/60", value: "text-amber-700 dark:text-amber-300" },
  violet: { chip: "bg-violet-50 text-violet-600 ring-violet-100 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/25", ring: "ring-violet-500/60", value: "text-violet-700 dark:text-violet-300" },
  red: { chip: "bg-red-50 text-red-600 ring-red-100 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/25", ring: "ring-red-500/60", value: "text-red-700 dark:text-red-300" },
  slate: { chip: "bg-muted text-muted-foreground ring-border", ring: "ring-border/60", value: "text-foreground" },
  teal: { chip: "bg-teal-50 text-teal-600 ring-teal-100 dark:bg-teal-500/15 dark:text-teal-400 dark:ring-teal-500/25", ring: "ring-teal-500/60", value: "text-teal-700 dark:text-teal-300" },
};

export function LeadMetricStrip({
  metrics,
  filters,
  query,
}: {
  metrics: LeadWorkspaceMetrics;
  filters: LeadWorkspaceFilters;
  query: Record<string, string>;
}) {
  const cards: MetricDef[] = [
    {
      key: "total",
      label: "Total assignments",
      value: metrics.total,
      icon: Layers,
      tone: "blue",
      param: "__all__",
      active: !filters.qualification?.length && !filters.workflowStatus?.length && !filters.scored,
    },
    {
      key: "qualified",
      label: "Qualified",
      value: metrics.qualified,
      icon: CheckCircle2,
      tone: "emerald",
      param: "qualification",
      paramValue: "QUALIFIED",
      active: filters.qualification?.includes("QUALIFIED") ?? false,
    },
    {
      key: "needsReview",
      label: "Needs review",
      value: metrics.needsReview,
      icon: AlertTriangle,
      tone: "amber",
      param: "qualification",
      paramValue: "NEEDS_REVIEW",
      active: filters.qualification?.includes("NEEDS_REVIEW") ?? false,
    },
    {
      key: "needsContact",
      label: "Needs decision-maker",
      value: metrics.needsContact,
      icon: UserPlus,
      tone: "violet",
      param: "qualification",
      paramValue: "COMPANY_QUALIFIED_NEEDS_CONTACT",
      active: filters.qualification?.includes("COMPANY_QUALIFIED_NEEDS_CONTACT") ?? false,
    },
    {
      key: "unqualified",
      label: "Unqualified",
      value: metrics.unqualified,
      icon: XCircle,
      tone: "red",
      param: "qualification",
      paramValue: "UNQUALIFIED",
      active: filters.qualification?.includes("UNQUALIFIED") ?? false,
    },
    {
      key: "notScored",
      label: "Not scored",
      value: metrics.notScored,
      icon: CircleDashed,
      tone: "slate",
      param: "qualification",
      paramValue: "NOT_SCORED",
      active: filters.qualification?.includes("NOT_SCORED") ?? false,
    },
    {
      key: "meetings",
      label: "Meetings",
      value: metrics.meetings,
      icon: CalendarCheck,
      tone: "teal",
      param: "workflowStatus",
      paramValue: "MEETING_BOOKED",
      active: filters.workflowStatus?.includes("MEETING_BOOKED") ?? false,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((card) => (
        <MetricLink key={card.key} card={card} query={query} />
      ))}
    </div>
  );
}

function MetricLink({
  card,
  query,
}: {
  card: MetricDef;
  query: Record<string, string>;
}) {
  const styles = toneStyles[card.tone];
  const Icon = card.icon;
  const href = buildMetricHref(query, card);

  return (
    <Link
      href={href}
      aria-pressed={card.active}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 shadow-sm transition-colors duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        card.active
          ? cn("border-transparent ring-2", styles.ring)
          : "border-hairline hover:border-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 h-8 w-8 items-center justify-center rounded-lg ring-1",
          styles.chip
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {card.label}
        </div>
        <div className={cn("mt-0.5 text-lg leading-none font-bold tracking-tight", styles.value)}>
          {formatCount(card.value)}
        </div>
      </div>
    </Link>
  );
}

function buildMetricHref(query: Record<string, string>, card: MetricDef) {
  const params = new URLSearchParams(query);
  params.delete("page");
  params.delete("selectedLeadId");

  if (card.param === "__all__") {
    params.delete("qualification");
    params.delete("workflowStatus");
    params.delete("scored");
  } else if (card.active) {
    // Clicking the active card toggles the filter off.
    params.delete(card.param);
  } else {
    params.set(card.param, card.paramValue ?? "");
    // Buckets are qualification-driven; clear the scored shortcut when picking one.
    if (card.param === "qualification") {
      params.delete("scored");
    }
  }

  const qs = params.toString();
  return qs ? `/v2/workspace/leads?${qs}` : "/v2/workspace/leads";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
