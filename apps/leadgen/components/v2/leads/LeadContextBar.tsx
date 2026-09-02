import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";

import type { LeadWorkspaceFilters } from "@/lib/v2/crm";

// Active-filter chips for /v2/leads. The Account/Project/ICP context is owned by
// the shell ContextBar (app/v2/layout.tsx) — this bar only surfaces the LIVE
// table filters as removable chips, and renders nothing when none are active
// (no empty chrome, no duplication with the shell context selector).

const FILTER_LABELS: Record<string, (value: string) => string> = {
  clientAccountId: () => "Account selected",
  projectId: () => "Project selected",
  icpVersionId: () => "ICP selected",
  qualification: (v) => `Qualification: ${humanize(v)}`,
  workflowStatus: (v) => `Workflow: ${humanize(v)}`,
  assignmentLevel: (v) => `Level: ${humanize(v)}`,
  scored: (v) => (v === "scored" ? "Scored only" : "Not scored only"),
  confidenceBand: (v) => `Confidence: ${humanize(v)}`,
  contactReadiness: contactReadinessLabel,
  enrollment: (v) => (v === "enrolled" ? "Running campaign sequence" : "No campaign sequence"),
  intelligenceStatus: (v) => `Intel: ${humanize(v)}`,
  factToken: (v) => `Facet: ${labelFactToken(v)}`,
  country: (v) => `Country: ${v}`,
  domain: (v) => `Domain: ${v}`,
  search: (v) => `Search: ${v}`,
};

export function LeadContextBar({
  filters,
  query,
}: {
  filters: LeadWorkspaceFilters;
  query: Record<string, string>;
}) {
  const active = collectActiveFilters(filters);

  if (active.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2.5 shadow-sm">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        Active filters
      </span>
      {active.map((filter) => (
        <Link
          key={filter.key}
          href={buildRemoveHref(query, filter.key)}
          className="group inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-primary/20 bg-accent py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary transition-colors duration-150 hover:bg-accent/70"
        >
          {filter.label}
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/70 text-primary group-hover:bg-primary">
            <X className="h-3 w-3" aria-hidden="true" />
          </span>
        </Link>
      ))}
      <Link
        href={buildClearHref(query)}
        className="ml-auto inline-flex cursor-pointer items-center rounded-full px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:bg-muted/40 hover:text-foreground"
      >
        Clear filters
      </Link>
    </div>
  );
}


function contactReadinessLabel(value: string): string {
  const labels: Record<string, string> = {
    has_email: "Email ready",
    ready: "Outreach ready",
    review: "Channel needs review",
    linkedin_only: "LinkedIn only",
    company_phone: "Company phone only",
    missing: "No contact channel",
    missing_email: "Missing ready email",
  };
  return labels[value] ?? humanize(value);
}
function collectActiveFilters(filters: LeadWorkspaceFilters): Array<{ key: string; label: string }> {
  const result: Array<{ key: string; label: string }> = [];
  for (const [key, format] of Object.entries(FILTER_LABELS)) {
    const value = filters[key as keyof LeadWorkspaceFilters];
    if (typeof value === "string" && value.trim()) {
      result.push({ key, label: format(value) });
    }
  }
  return result;
}

function buildRemoveHref(query: Record<string, string>, key: string) {
  const params = new URLSearchParams(query);
  params.delete(key);
  params.delete("page");
  const qs = params.toString();
  return qs ? `/v2/workspace/leads?${qs}` : "/v2/workspace/leads";
}

function buildClearHref(query: Record<string, string>) {
  const params = new URLSearchParams();
  // Keep only the required scoring context (owned by the shell selector).
  for (const key of ["clientAccountId", "projectId", "icpVersionId"]) {
    if (query[key]) params.set(key, query[key]);
  }
  const qs = params.toString();
  return qs ? `/v2/workspace/leads?${qs}` : "/v2/workspace/leads";
}

function humanize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function labelFactToken(token: string) {
  const employeeCount = token.match(/^size\.employee_count_(\d+)$/);
  if (employeeCount) return `${Number(employeeCount[1]).toLocaleString("en-US")} employees`;

  const revenue = token.match(/^revenue\.usd_(\d+)$/);
  if (revenue) return `$${Number(revenue[1]).toLocaleString("en-US")} revenue`;

  return humanize(token.split(".").slice(1).join("_") || token);
}
