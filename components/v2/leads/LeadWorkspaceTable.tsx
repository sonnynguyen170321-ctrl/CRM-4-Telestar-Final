import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, Eye, Send, X } from "lucide-react";

import { RouteListKeyboard } from "@/components/shared/RouteListKeyboard";
import { ScoreRing } from "@/components/shared/ScoreRing";
import { Button } from "@/components/ui/button";
import {
  AccountPreRankBadge,
  ConfidenceBadge,
  QualificationBadge,
  WorkflowBadge,
} from "@/components/v2/leads/AssessmentSummaryCard";
import { AddToCampaignDialog, type CampaignOption } from "@/components/v2/leads/AddToCampaignDialog";
import {
  LeadRowCheckbox,
  LeadSelectAllCheckbox,
} from "@/components/v2/leads/LeadSelection";
import { useLeadDrawer } from "./LeadDrawerProvider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeadWorkspaceQueryResult, LeadWorkspaceRow } from "@/lib/v2/crm";

type LeadWorkspaceTableProps = {
  result: LeadWorkspaceQueryResult;
  query: Record<string, string>;
  selectedLeadId?: string;
  campaigns: CampaignOption[];
};

export function LeadWorkspaceTable({
  result,
  query,
  selectedLeadId,
  campaigns,
}: LeadWorkspaceTableProps) {
  // "Work this account": when filtered to one company, show a clearable chip.
  const companyFilterActive = Boolean(query.companyId);
  const focusedCompanyName = result.rows[0]?.companyName ?? "this company";
  const companyChip = companyFilterActive ? (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-accent px-3 py-2 text-sm text-accent-foreground">
      <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
      <span className="font-medium">Working account: {focusedCompanyName}</span>
      <Link
        href={buildHref(query, { companyId: "", selectedLeadId: "", page: "" })}
        className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-accent/70"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Clear
      </Link>
    </div>
  ) : null;

  if (result.rows.length === 0) {
    return (
      <>
        {companyChip}
        <div className="rounded-xl border border-dashed border-hairline bg-surface p-8 text-center shadow-sm">
          <div className="text-sm font-medium text-foreground">No prospects match this view</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {companyFilterActive
              ? "No leads for this company in the selected Project + ICP. Clear the company filter or switch context."
              : "Adjust the sidebar filters, or run scoring for the selected Project + ICP."}
          </p>
        </div>
      </>
    );
  }

  const visibleIds = result.rows.map((row) => row.leadAssignmentId);
  const rowHrefs = result.rows.map((row) => buildHref(query, { selectedLeadId: row.leadAssignmentId }));

  return (
    <>
    <RouteListKeyboard hrefs={rowHrefs} ids={visibleIds} activeId={selectedLeadId} />
    {companyChip}
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm">
      <Table>
        <TableHeader className="bg-surface-raised">
          <TableRow>
            <TableHead className="w-10 px-3">
              <LeadSelectAllCheckbox ids={visibleIds} />
            </TableHead>
            <TableHead className="min-w-64 px-3">Contact</TableHead>
            <TableHead className="px-3">Owner</TableHead>
            <TableHead className="px-3">Last touch</TableHead>
            <TableHead className="px-3">Status</TableHead>
            <TableHead className="min-w-52 px-3">Outreach</TableHead>
            <TableHead className="min-w-48 px-3">Company</TableHead>
            <TableHead className="min-w-48 px-3">ICP</TableHead>
            <TableHead className="px-3 text-right">Fit</TableHead>
            <TableHead className="px-3">Qualification</TableHead>
            <TableHead className="px-3">Confidence</TableHead>
            <TableHead className="px-3">Workflow</TableHead>
            <TableHead className="min-w-64 px-3">Why</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row) => {
            return (
              <LeadRow
                key={row.leadAssignmentId}
                row={row}
                selected={row.leadAssignmentId === selectedLeadId}
                query={query}
                campaigns={campaigns}
              />
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3 text-sm text-muted-foreground bg-surface">
        <div>
          Page {result.pagination.page} of {result.pagination.totalPages} - {result.pagination.total} prospects
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild disabled={result.pagination.page <= 1}>
            <Link
              aria-disabled={result.pagination.page <= 1}
              href={buildHref(query, { page: String(Math.max(1, result.pagination.page - 1)) })}
            >
              Previous
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild disabled={result.pagination.page >= result.pagination.totalPages}>
            <Link
              aria-disabled={result.pagination.page >= result.pagination.totalPages}
              href={buildHref(query, {
                page: String(Math.min(result.pagination.totalPages, result.pagination.page + 1)),
              })}
            >
              Next
            </Link>
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}

function LeadRow({
  row,
  query,
  selected,
  campaigns,
}: {
  row: LeadWorkspaceRow;
  query: Record<string, string>;
  selected: boolean;
  campaigns: CampaignOption[];
}) {
  const assessment = row.latestAssessment;
  const { open } = useLeadDrawer();
  const displayName = row.contactDisplayName ?? row.contactName;
  const snapshot = {
    leadAssignmentId: row.leadAssignmentId,
    contactName: displayName,
    contactTitle: row.contactTitle,
    companyName: row.companyName,
  };
  const focusCompanyHref = buildHref(query, {
    companyId: row.companyId,
    selectedLeadId: "",
    page: "",
  });

  return (
    <TableRow className={selected ? "bg-accent/70" : "transition-colors hover:bg-muted/50"}>
      <TableCell className="px-3 align-top">
        <div className="pt-1">
          <LeadRowCheckbox leadAssignmentId={row.leadAssignmentId} />
        </div>
      </TableCell>
      <TableCell className="px-3 align-top">
        <button
          type="button"
          onClick={() => open(snapshot)}
          className="block w-full text-left cursor-pointer focus:outline-none"
        >
          {row.contactName ? (
            <>
              <div className="font-semibold text-foreground">{displayName}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{row.contactTitle ?? "No title recorded"}</div>
              <div className={`mt-1 text-xs font-medium ${row.contactEmail ? "text-emerald-700" : "text-amber-700"}`}>
                {row.contactEmail ?? "Missing verified email"}
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold text-foreground">Company-level lead</div>
              <div className="mt-0.5 text-xs font-medium text-amber-700">No contact yet - add one to work it</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{row.companyName}</div>
            </>
          )}
        </button>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <TinyBadge tone="slate">{row.linkedProjectCount} proj</TinyBadge>
          <TinyBadge tone="slate">{row.linkedIcpCount} ICP</TinyBadge>
        </div>
      </TableCell>
      <TableCell className="px-3 align-top">
        <OwnerCell name={row.ownerName} />
      </TableCell>
      <TableCell className="px-3 align-top text-xs text-muted-foreground">
        {row.lastTouchAt ? (
          <div>
            <div className="font-medium text-foreground">{relativeTime(row.lastTouchAt)}</div>
            {row.lastTouchChannel ? <div className="text-muted-foreground">{formatLabel(row.lastTouchChannel)}</div> : null}
          </div>
        ) : (
          <span className="text-muted-foreground">No touch</span>
        )}
      </TableCell>
      <TableCell className="px-3 align-top">
        <div className="flex flex-col gap-1">
          <TinyBadge tone={row.meetingStatus === "NONE" ? "slate" : "green"}>
            {row.meetingStatus === "DONE" ? "Meeting done" : row.meetingStatus === "BOOKED" ? "Meeting booked" : "No meeting"}
          </TinyBadge>
          <TinyBadge tone={row.reviewStatus === "REVIEWED" ? "green" : "slate"}>
            {row.reviewStatus === "REVIEWED" ? "Reviewed" : "Not reviewed"}
          </TinyBadge>
        </div>
      </TableCell>
      <TableCell className="px-3 align-top">
        <div className="flex flex-wrap gap-1.5">
          {row.contactEmail ? (
            <Button size="sm" variant="outline" className="h-8 cursor-pointer px-2" asChild>
              <Link href={`/v2/outreach/compose?leadAssignmentId=${row.leadAssignmentId}`}>
                <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Email
              </Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-8 px-2" disabled>
              <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Email
            </Button>
          )}
          <AddToCampaignDialog leadAssignmentIds={[row.leadAssignmentId]} campaigns={campaigns} />
          <Button
            size="sm"
            variant="ghost"
            className="h-8 cursor-pointer px-2"
            onClick={() => open(snapshot)}
          >
            <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Detail
          </Button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <TinyBadge tone={row.hasVerifiedEmail ? "green" : "amber"}>
            {row.hasVerifiedEmail ? "Email ready" : "Needs email"}
          </TinyBadge>
          <TinyBadge tone={row.activeEnrollmentCount > 0 ? "blue" : "slate"}>
            {row.activeEnrollmentCount > 0 ? `${row.activeEnrollmentCount} running sequence` : "No campaign sequence"}
          </TinyBadge>
        </div>
      </TableCell>
      <TableCell className="px-3 align-top">
        <button
          type="button"
          onClick={() => open(snapshot)}
          className="block w-full text-left cursor-pointer focus:outline-none"
        >
          <div className="text-sm font-medium text-foreground">{row.companyName}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {[row.companyDomain, row.companyCountry].filter(Boolean).join(" / ") || "No domain"}
          </div>
        </button>
        {query.companyId ? null : (
          <Link
            href={focusCompanyHref}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
          >
            <Building2 className="h-3 w-3" aria-hidden="true" />
            Work this account
          </Link>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <TinyBadge tone={row.companyIntelligenceStatus === "EXTRACTED" ? "green" : row.companyIntelligenceStatus ? "amber" : "slate"}>
            {row.companyIntelligenceStatus ? formatLabel(row.companyIntelligenceStatus) : "No intel"}
          </TinyBadge>
          {Array.from(new Set(row.companyFactTokens)).slice(0, 2).map((token) => (
            <TinyBadge key={token} tone="blue">
              {labelFactToken(token)}
            </TinyBadge>
          ))}
        </div>
      </TableCell>
      <TableCell className="px-3 align-top">
        <div className="text-sm font-medium text-foreground">{row.projectName}</div>
        <Link href={`/v2/icp-library?icpVersionId=${row.icpVersionId}`} className="mt-0.5 block text-xs font-medium text-primary hover:text-primary/80">
          {row.icpProfileName} v{row.icpVersionNumber}
        </Link>
      </TableCell>
      <TableCell className="px-3 align-top">
        <div className="flex justify-end">
          {assessment ? <ScoreRing score={assessment.fitScore} size="sm" /> : <span className="text-xs font-medium uppercase text-muted-foreground">Not scored</span>}
        </div>
      </TableCell>
      <TableCell className="px-3 align-top">
        <QualificationBadge qualification={row.qualification} />
        {row.accountPreRank ? <div className="mt-1"><AccountPreRankBadge accountPreRank={row.accountPreRank} /></div> : null}
      </TableCell>
      <TableCell className="px-3 align-top">
        {assessment?.confidenceBand ? <ConfidenceBadge confidenceBand={assessment.confidenceBand} /> : <span className="text-xs text-muted-foreground">No confidence</span>}
      </TableCell>
      <TableCell className="px-3 align-top">
        <WorkflowBadge workflowStatus={row.workflowStatus} />
      </TableCell>
      <TableCell className="max-w-72 px-3 align-top text-sm text-muted-foreground">
        <button
          type="button"
          onClick={() => open(snapshot)}
          className="block w-full text-left cursor-pointer focus:outline-none hover:text-foreground line-clamp-3"
        >
          {assessment?.reason ?? "No persisted score yet. Run scoring for this Project + ICP."}
        </button>
      </TableCell>
    </TableRow>
  );
}

function OwnerCell({ name }: { name: string | null }) {
  if (!name) {
    return <span className="text-xs text-muted-foreground">Unassigned</span>;
  }
  const initials = name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
        {initials}
      </span>
      <span className="truncate text-xs font-medium text-foreground">{name}</span>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function buildHref(query: Record<string, string>, updates: Record<string, string>) {
  const params = new URLSearchParams(query);

  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  return `/v2/workspace/leads?${params.toString()}`;
}

function TinyBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "green" | "amber" | "blue" | "slate";
}) {
  const className = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-primary/20 bg-accent text-primary",
    slate: "border-border bg-muted/40 text-muted-foreground",
  }[tone];

  return (
    <span className={`inline-flex max-w-40 truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function labelFactToken(token: string) {
  const employeeCount = token.match(/^size\.employee_count_(\d+)$/);
  if (employeeCount) return `${Number(employeeCount[1]).toLocaleString("en-US")} employees`;

  const revenue = token.match(/^revenue\.usd_(\d+)$/);
  if (revenue) return `$${Number(revenue[1]).toLocaleString("en-US")} revenue`;

  return formatLabel(token.split(".").slice(1).join("_") || token);
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}
