import Link from "next/link";
import { Download, ChevronRight, Info } from "lucide-react";

import { RescoreViewButton } from "@/components/v2/leads/RescoreViewButton";
import type { LeadWorkspaceFilters } from "@/lib/v2/crm";

// Right rail for /v2/leads. Every control is REAL: saved views are filter links,
// Export is the live CSV route, Run scoring re-scores the current view. No dead
// buttons, no mock-as-truth.

type SavedView = {
  key: string;
  label: string;
  description: string;
  params: Record<string, string>;
  match: (filters: LeadWorkspaceFilters) => boolean;
};

const SAVED_VIEWS: SavedView[] = [
  {
    key: "qualified",
    label: "Ready for campaign",
    description: "Qualified with a ready channel and no running campaign sequence",
    params: {
      qualification: "QUALIFIED",
      contactReadiness: "ready",
      enrollment: "not_enrolled",
    },
    match: (f) =>
      (f.qualification?.includes("QUALIFIED") ?? false) &&
      f.contactReadiness === "ready" &&
      f.enrollment === "not_enrolled",
  },
  {
    key: "needs-action",
    label: "Needs review",
    description: "Borderline evidence",
    params: { qualification: "NEEDS_REVIEW" },
    match: (f) => f.qualification?.includes("NEEDS_REVIEW") ?? false,
  },
  {
    key: "needs-email",
    label: "Needs decision-maker",
    description: "Company/contact not email-ready",
    params: { qualification: "COMPANY_QUALIFIED_NEEDS_CONTACT" },
    match: (f) => f.qualification?.includes("COMPANY_QUALIFIED_NEEDS_CONTACT") ?? false,
  },
  {
    key: "running-campaign-sequence",
    label: "Running campaign sequences",
    description: "Already running in a campaign",
    params: { enrollment: "enrolled" },
    match: (f) => f.enrollment === "enrolled",
  },
  {
    key: "missing-intel",
    label: "Needs company intel",
    description: "No extracted profile yet",
    params: { intelligenceStatus: "MISSING" },
    match: (f) => f.intelligenceStatus?.includes("MISSING") ?? false,
  },
  {
    key: "not-scored",
    label: "Not scored yet",
    description: "Run scoring on these",
    params: { scored: "unscored" },
    match: (f) => f.scored === "unscored" || (f.qualification?.includes("NOT_SCORED") ?? false),
  },
  {
    key: "meeting",
    label: "Meeting booked",
    description: "In the pipeline",
    params: { workflowStatus: "MEETING_BOOKED" },
    match: (f) => f.workflowStatus?.includes("MEETING_BOOKED") ?? false,
  },
];

export function LeadWorkspaceRail({
  query,
  filters,
  projectId,
  icpVersionId,
  exportHref,
}: {
  query: Record<string, string>;
  filters: LeadWorkspaceFilters;
  projectId?: string;
  icpVersionId?: string;
  exportHref: string;
}) {
  return (
    <div className="space-y-4">
      <RailCard title="View actions">
        <div className="space-y-2.5">
          <RescoreViewButton projectId={projectId} icpVersionId={icpVersionId} label="Run scoring on this view" />
          <a
            href={exportHref}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export this view (CSV)
          </a>
          <Link
            href={"/v2/outreach/campaigns"}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2"
          >
            Go to Campaigns
          </Link>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Export carries the immutable assessment snapshot so the file equals the
          filtered table — ready to hand to an enrichment tool.
        </p>
      </RailCard>

      <RailCard title="Saved views">
        <ul className="space-y-1">
          {SAVED_VIEWS.map((view) => {
            const active = view.match(filters);
            return (
              <li key={view.key}>
                <Link
                  href={buildViewHref(query, view.params)}
                  aria-current={active ? "true" : undefined}
                  className={`group flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors duration-150 ${
                    active
                      ? "border-primary/20 bg-accent"
                      : "border-transparent hover:border-border hover:bg-muted/40"
                  }`}
                >
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}>
                      {view.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{view.description}</span>
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground group-hover:text-muted-foreground"}`}
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </RailCard>

      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Design note
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          The ICP column stays visible — a company is scored once per ICP, never
          globally. Qualification and workflow status are separate. NOT_SCORED is
          derived, never stored.
        </p>
      </div>
    </div>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function buildViewHref(query: Record<string, string>, params: Record<string, string>) {
  const next = new URLSearchParams();
  // Preserve required scoring context only; saved views own the bucket filters.
  for (const key of ["clientAccountId", "projectId", "icpVersionId"]) {
    if (query[key]) next.set(key, query[key]);
  }
  for (const [key, value] of Object.entries(params)) {
    next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/v2/workspace/leads?${qs}` : "/v2/workspace/leads";
}
