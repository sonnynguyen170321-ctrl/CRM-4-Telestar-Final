import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, Eye, Mail, Send, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QualificationBadge, WorkflowBadge } from "@/components/v2/leads/AssessmentSummaryCard";
import { AddToCampaignDialog, type CampaignOption } from "@/components/v2/leads/AddToCampaignDialog";
import { LeadRowCheckbox, LeadSelectAllCheckbox } from "@/components/v2/leads/LeadSelection";
import { LeadRowOpen } from "@/components/v2/leads/LeadRowOpen";
import type { LeadDrawerSnapshot } from "@/components/v2/leads/LeadDrawerProvider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContactLeadRow, ContactLeadsResult } from "@/lib/v2/crm";

type ContactLeadsTableProps = {
  result: ContactLeadsResult;
  query: Record<string, string>;
  selectedLeadId?: string;
  campaigns: CampaignOption[];
};

const PAGE_SIZE_PRESETS = [25, 50, 100, 250];

export function ContactLeadsTable({ result, query, selectedLeadId, campaigns }: ContactLeadsTableProps) {
  if (result.rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <div className="text-sm font-medium text-foreground">No contacts match this view</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Adjust the filters, or add a contact-level assignment. Company-level leads with no
          contact live in <Link href="/v2/crm/companies" className="font-medium text-primary hover:text-primary/80">Companies</Link>.
        </p>
      </div>
    );
  }

  const visibleIds = result.rows.map((r) => r.leadAssignmentId);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 border-b border-border bg-muted/95 backdrop-blur">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 px-3"><LeadSelectAllCheckbox ids={visibleIds} /></TableHead>
              <TableHead className="min-w-64 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contact</TableHead>
              <TableHead className="min-w-52 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Company</TableHead>
              <TableHead className="min-w-40 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</TableHead>
              <TableHead className="min-w-40 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Owner &amp; activity</TableHead>
              <TableHead className="min-w-44 px-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <ContactRow
                key={row.contactId}
                row={row}
                selected={row.leadAssignmentId === selectedLeadId}
                campaigns={campaigns}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <PaginationFooter result={result} query={query} />
    </div>
  );
}

function ContactRow({
  row,
  selected,
  campaigns,
}: {
  row: ContactLeadRow;
  selected: boolean;
  campaigns: CampaignOption[];
}) {
  const snapshot: LeadDrawerSnapshot = {
    leadAssignmentId: row.leadAssignmentId,
    contactName: row.contactName,
    contactTitle: row.contactTitle ?? row.seniorityTier,
    companyName: row.companyName,
  };
  return (
    <TableRow className={`border-b border-border ${selected ? "bg-accent/60" : "transition-colors hover:bg-muted/70"}`}>
      <TableCell className="px-3 align-top"><div className="pt-2"><LeadRowCheckbox leadAssignmentId={row.leadAssignmentId} /></div></TableCell>

      {/* Contact — the whole identity block opens the drawer */}
      <TableCell className="px-3 py-3 align-top">
        <LeadRowOpen snapshot={snapshot} className="group block w-full cursor-pointer text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
              {initialsOf(row.contactName)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-foreground group-hover:text-primary">{row.contactName ?? "Company-level lead"}</div>
              <div className="truncate text-xs text-muted-foreground">{row.contactTitle ?? row.seniorityTier}</div>
            </div>
          </div>
        </LeadRowOpen>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-11 text-xs">
          <span className={`inline-flex items-center gap-1 ${row.emailUsable ? "text-muted-foreground" : "text-amber-600"}`}>
            <Mail className="h-3 w-3" aria-hidden="true" />{row.email ?? "no ready email"}
          </span>
          {row.phone ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" aria-hidden="true" />{row.phone}</span> : null}
          {row.linkedInUrl ? <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">in</span> : null}
          <ContactabilityPill status={row.contactabilityStatus} />
        </div>
      </TableCell>

      {/* Company — name, domain, intel, linked counts, view link */}
      <TableCell className="px-3 py-3 align-top">
        <div className="flex items-start gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-primary">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{row.companyName}</div>
            <div className="truncate text-xs text-muted-foreground">{row.companyDomain ?? row.companyCountry ?? "—"}</div>
          </div>
        </div>
        <IntelCell status={row.companyIntelligenceStatus} tokens={row.companyFactTokens} />
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{row.linkedProjectCount} proj / {row.linkedIcpCount} ICP</span>
          <Link href={`/v2/crm/companies?companyId=${row.companyId}`} className="font-medium text-primary hover:text-primary/80">View company</Link>
        </div>
      </TableCell>

      {/* Status — qualification + workflow, with meeting/review as inline signals */}
      <TableCell className="px-3 py-3 align-top">
        <div className="flex flex-col gap-1.5">
          <QualificationBadge qualification={row.qualification} />
          <div className="text-[11px] leading-tight text-muted-foreground">{row.projectName} � {row.icpProfileName} v{row.icpVersionNumber}</div>
          <WorkflowBadge workflowStatus={row.workflowStatus} />
          <div className="flex flex-wrap gap-1">
            {row.meetingStatus !== "NONE" ? (
              <Pill tone="green">{row.meetingStatus === "DONE" ? "Meeting done" : "Meeting booked"}</Pill>
            ) : null}
            {row.reviewStatus === "REVIEWED" ? <Pill tone="blue">Reviewed</Pill> : null}
            {row.activeEnrollmentCount > 0 ? <Pill tone="blue">{row.activeEnrollmentCount} running sequence</Pill> : null}
          </div>
        </div>
      </TableCell>

      {/* Owner & activity */}
      <TableCell className="px-3 py-3 align-top">
        <OwnerCell name={row.ownerName} />
        <div className="mt-1.5 text-xs text-muted-foreground">
          {row.lastTouchAt ? (
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-muted-foreground">{relativeTime(row.lastTouchAt)}</span>
              {row.lastTouchChannel ? <span className="text-muted-foreground">/ {formatLabel(row.lastTouchChannel)}</span> : null}
            </span>
          ) : <span className="text-muted-foreground">No touch yet</span>}
        </div>
      </TableCell>

      {/* Actions */}
      <TableCell className="px-3 py-3 align-top">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {row.emailUsable ? (
            <Button size="sm" variant="outline" className="h-8 cursor-pointer px-2" asChild>
              <Link href={`/v2/outreach/compose?leadAssignmentId=${row.leadAssignmentId}`}><Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Email</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-8 px-2" disabled><Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Email</Button>
          )}
          <AddToCampaignDialog leadAssignmentIds={row.emailUsable ? [row.leadAssignmentId] : []} campaigns={campaigns} />
          <LeadRowOpen
            snapshot={snapshot}
            className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Detail
          </LeadRowOpen>
        </div>
      </TableCell>
    </TableRow>
  );
}


function ContactabilityPill({ status }: { status: ContactLeadRow["contactabilityStatus"] }) {
  const meta: Record<ContactLeadRow["contactabilityStatus"], { label: string; tone: "green" | "blue" | "amber" | "slate" | "red" }> = {
    ready: { label: "Ready", tone: "green" },
    review: { label: "Review channel", tone: "amber" },
    linkedin_only: { label: "LinkedIn only", tone: "blue" },
    company_phone: { label: "Company phone", tone: "slate" },
    missing: { label: "No channel", tone: "red" },
  };
  const item = meta[status] ?? meta.missing;
  return <Pill tone={item.tone}>{item.label}</Pill>;
}
function initialsOf(name: string | null): string {
  if (!name) return "—";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "—";
}

function PaginationFooter({ result, query }: { result: ContactLeadsResult; query: Record<string, string> }) {
  const { page, pageSize, total, totalPages } = result.pagination;
  return (
    <div className="shrink-0 bg-card flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span>Page {page} of {totalPages} / {total} contacts</span>
        <span className="text-muted-foreground/50">|</span>
        <span className="text-xs text-muted-foreground">Show</span>
        {PAGE_SIZE_PRESETS.map((n) => (
          <Link
            key={n}
            href={buildHref(query, { pageSize: String(n), page: "" })}
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${pageSize === n ? "bg-accent/70 text-primary" : "text-muted-foreground hover:bg-muted"}`}
          >
            {n}
          </Link>
        ))}
        <Link
          href={buildHref(query, { pageSize: "1000", page: "" })}
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${pageSize >= 1000 ? "bg-accent/70 text-primary" : "text-muted-foreground hover:bg-muted"}`}
        >
          All
        </Link>
        <form action="/v2/workspace/leads" className="ml-1 inline-flex items-center gap-1">
          {Object.entries(query)
            .filter(([k]) => k !== "pageSize" && k !== "page")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <input
            type="number"
            name="pageSize"
            min={1}
            max={1000}
            placeholder="#"
            defaultValue={pageSize}
            className="h-7 w-16 rounded border border-border px-2 text-xs outline-none focus:border-primary"
          />
          <button type="submit" className="rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50">Set</button>
        </form>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild disabled={page <= 1}>
          <Link aria-disabled={page <= 1} href={buildHref(query, { page: String(Math.max(1, page - 1)) })}>Previous</Link>
        </Button>
        <Button variant="outline" size="sm" asChild disabled={page >= totalPages}>
          <Link aria-disabled={page >= totalPages} href={buildHref(query, { page: String(Math.min(totalPages, page + 1)) })}>Next</Link>
        </Button>
      </div>
    </div>
  );
}

const INTEL_STATUS: Record<string, { label: string; tone: "green" | "slate" | "amber" | "red" }> = {
  EXTRACTED: { label: "Enriched", tone: "green" },
  PARTIAL: { label: "Partial intel", tone: "amber" },
  PLACEHOLDER: { label: "Queued", tone: "slate" },
  FAILED: { label: "Intel failed", tone: "red" },
};

// Surface the company-intelligence status + a couple of the most telling fact
// tokens right on the row, so an SDR can triage what a company does without
// opening the drawer. Tokens are picked identity-first (category/industry/offering).
function IntelCell({ status, tokens }: { status: string | null; tokens: string[] }) {
  const meta = status ? INTEL_STATUS[status] ?? null : null;
  const top = pickIntelTokens(tokens);
  if (!meta && top.length === 0) {
    return <div className="mt-1 text-[11px] text-muted-foreground">Not enriched</div>;
  }
  const toneCls = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-muted text-muted-foreground",
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {meta ? (
        <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${toneCls[meta.tone]}`}>{meta.label}</span>
      ) : null}
      {Array.from(new Set(top)).map((t, idx) => (
        <span key={`${t}-${idx}`} className="inline-flex rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground" title={t}>{t}</span>
      ))}
    </div>
  );
}

function pickIntelTokens(tokens: string[]): string[] {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const priority = ["category.", "industry.", "offering.", "business_model."];
  const picked: string[] = [];
  for (const prefix of priority) {
    for (const token of tokens) {
      if (token.startsWith(prefix) && !picked.includes(token)) picked.push(token);
      if (picked.length >= 3) break;
    }
    if (picked.length >= 3) break;
  }
  return picked.slice(0, 3).map((t) => formatLabel(t.slice(t.indexOf(".") + 1)));
}

function OwnerCell({ name }: { name: string | null }) {
  if (!name) return <span className="text-xs text-muted-foreground">Unassigned</span>;
  const initials = name.split(/\s+/).map((p) => p.charAt(0)).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{initials}</span>
      <span className="truncate text-xs font-medium text-foreground">{name}</span>
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: "green" | "blue" | "amber" | "red" | "slate" }) {
  const cls = {
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-accent text-primary",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-muted text-muted-foreground",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
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

function formatLabel(value: string): string {
  return value.split("_").map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
}

function buildHref(query: Record<string, string>, updates: Record<string, string>): string {
  const params = new URLSearchParams(query);
  for (const [k, v] of Object.entries(updates)) {
    if (v) params.set(k, v);
    else params.delete(k);
  }
  return `/v2/workspace/leads?${params.toString()}`;
}
