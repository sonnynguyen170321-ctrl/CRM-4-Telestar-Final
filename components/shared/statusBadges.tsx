import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { CompanyType, Qualification } from "@/lib/types/company";
import { cn } from "@/lib/utils";

type BadgeProps = {
  className?: string;
};

export type CanonicalQualification =
  | "QUALIFIED"
  | "COMPANY_QUALIFIED_NEEDS_CONTACT"
  | "NEEDS_REVIEW"
  | "UNQUALIFIED"
  | "NOT_SCORED";

const companyTypeStyles: Record<CompanyType, string> = {
  "Not Relevant": "border-slate-200 bg-slate-50 text-slate-700",
  PAAS: "border-sky-200 bg-sky-50 text-sky-800",
  SAAS: "border-blue-200 bg-blue-50 text-blue-800",
  Cloud: "border-cyan-200 bg-cyan-50 text-cyan-800",
  ITO: "border-zinc-200 bg-zinc-50 text-zinc-800",
  "Data Solution": "border-violet-200 bg-violet-50 text-violet-800",
  "AI Solution": "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800",
  "AI Service": "border-purple-200 bg-purple-50 text-purple-800",
  "Cyber Security": "border-rose-200 bg-rose-50 text-rose-800",
  "Blockchain Solution": "border-amber-200 bg-amber-50 text-amber-800",
};

const canonicalQualificationStyles: Record<CanonicalQualification, string> = {
  QUALIFIED:
    "border-qual-qualified-border bg-qual-qualified-surface text-qual-qualified-foreground",
  COMPANY_QUALIFIED_NEEDS_CONTACT:
    "border-qual-needs-contact-border bg-qual-needs-contact-surface text-qual-needs-contact-foreground",
  NEEDS_REVIEW:
    "border-qual-needs-review-border bg-qual-needs-review-surface text-qual-needs-review-foreground",
  UNQUALIFIED:
    "border-qual-unqualified-border bg-qual-unqualified-surface text-qual-unqualified-foreground",
  NOT_SCORED:
    "border-dashed border-qual-not-scored-border bg-qual-not-scored-surface text-qual-not-scored-foreground",
};

const legacyQualificationStyles: Partial<Record<Qualification, string>> = {
  qualified: canonicalQualificationStyles.QUALIFIED,
  unqualified: canonicalQualificationStyles.UNQUALIFIED,
};

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: BadgeProps & {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass = {
    neutral: "border-border bg-muted/60 text-muted-foreground",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300",
    danger: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/25 dark:bg-red-500/15 dark:text-red-300",
    info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/25 dark:bg-blue-500/15 dark:text-blue-300",
  }[tone];

  return (
    <Badge variant="outline" className={cn("rounded-md", toneClass, className)}>
      {children}
    </Badge>
  );
}

export function QualificationBadge({
  qualification,
  className,
}: BadgeProps & {
  qualification: Qualification | string | null | undefined;
}) {
  const value = qualification ?? "unknown";
  const style = getQualificationBadgeClassName(value);

  return (
    <Badge
      variant="outline"
      className={cn("rounded-md capitalize", style, className)}
    >
      {value}
    </Badge>
  );
}

export function getQualificationBadgeClassName(
  qualification: Qualification | string | null | undefined
) {
  if (isCanonicalQualification(qualification)) {
    return canonicalQualificationStyles[qualification];
  }

  if (
    typeof qualification === "string" &&
    qualification in legacyQualificationStyles
  ) {
    return legacyQualificationStyles[qualification as Qualification];
  }

  return "border-border bg-muted/60 text-muted-foreground";
}

export function isCanonicalQualification(
  qualification: Qualification | string | null | undefined
): qualification is CanonicalQualification {
  return (
    qualification === "QUALIFIED" ||
    qualification === "COMPANY_QUALIFIED_NEEDS_CONTACT" ||
    qualification === "NEEDS_REVIEW" ||
    qualification === "UNQUALIFIED" ||
    qualification === "NOT_SCORED"
  );
}

export function CompanyTypeBadge({
  companyType,
  className,
}: BadgeProps & {
  companyType: CompanyType | string | null | undefined;
}) {
  const value = companyType ?? "Unknown";
  const style =
    value in companyTypeStyles
      ? companyTypeStyles[value as CompanyType]
      : "border-border bg-muted/60 text-muted-foreground";

  return (
    <Badge variant="outline" className={cn("rounded-md", style, className)}>
      {value}
    </Badge>
  );
}

export function ScoreBadge({
  score,
  className,
}: BadgeProps & {
  score: number | null | undefined;
}) {
  const value = typeof score === "number" ? Math.round(score) : null;
  const tone =
    value === null
      ? "neutral"
      : value >= 85
        ? "success"
        : value >= 70
          ? "info"
          : value >= 50
            ? "warning"
            : value >= 30
              ? "neutral"
              : "danger";

  return (
    <StatusBadge tone={tone} className={className}>
      {value === null ? "No score" : `Score ${value}`}
    </StatusBadge>
  );
}

export function ResearchBadge({
  status,
  quality,
  className,
}: BadgeProps & {
  status?: string | null;
  quality?: string | null;
}) {
  const label = [status, quality].filter(Boolean).join(" / ") || "No research";
  const lower = `${status ?? ""} ${quality ?? ""}`.toLowerCase();
  const tone = lower.includes("failed")
    ? "danger"
    : lower.includes("weak") || lower.includes("partial")
      ? "warning"
      : lower.includes("success") || lower.includes("strong")
        ? "success"
        : "neutral";

  return (
    <StatusBadge tone={tone} className={className}>
      {label}
    </StatusBadge>
  );
}
