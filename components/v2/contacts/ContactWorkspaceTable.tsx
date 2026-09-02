"use client";

import Link from "next/link";
import { Eye, Send, Mail, Link as LinkIcon, Building2, AlertTriangle } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { QualificationBadge } from "@/components/v2/leads/AssessmentSummaryCard";
import { LeadRowCheckbox, LeadSelectAllCheckbox } from "@/components/v2/leads/LeadSelection";
import { AddToCampaignDialog, type CampaignOption } from "@/components/v2/leads/AddToCampaignDialog";
import { contactDrawerHref, composeHref, leadDrawerHref } from "@/lib/v2/crm/leadRoutes";
import { RouteListKeyboard } from "@/components/shared/RouteListKeyboard";
import { AssignOwnerDialog, type AssignableMember } from "./AssignOwnerDialog";
import { assignOwnerAction } from "@/app/v2/crm/contacts/assignOwnerAction";
import type { ContactsWorkspace } from "@/lib/v2/crm/shapeContacts";
import type { LeadWorkspaceQualification } from "@/lib/v2/crm";
import { DataTable, type DataTableColumn, DataTablePagination } from "@/components/shared/DataTable";
import { formatCount } from "@/lib/v2/format/datetime";

const QUALIFICATIONS = new Set([
  "QUALIFIED",
  "NEEDS_REVIEW",
  "UNQUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
  "NOT_SCORED",
]);

function buildHref(query: Record<string, string | string[]>, updates: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else {
      params.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `/v2/crm/contacts?${params.toString()}`;
}

function SeniorityPill({ tier, department }: { tier: string; department: string }) {
  let color = "bg-muted text-foreground border-border";
  if (tier === "C_LEVEL" || tier === "OWNER") color = "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/25";
  else if (tier === "VP") color = "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/25";
  else if (tier === "DIRECTOR") color = "bg-accent text-primary border-primary/20";
  else if (tier === "HEAD" || tier === "LEAD") color = "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/25";
  else if (tier === "MANAGER") color = "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/25";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${color}`}>
      {tier} · {department}
    </span>
  );
}

function SignalIcons({ email, linkedin, enriched, review }: { email: boolean; linkedin: boolean; enriched: boolean; review: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <div title={email ? "Email present" : "No email"} className={`flex h-4 w-4 items-center justify-center rounded-full ${email ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
        <Mail className="h-2.5 w-2.5" />
      </div>
      <div title={linkedin ? "LinkedIn present" : "No LinkedIn"} className={`flex h-4 w-4 items-center justify-center rounded-full ${linkedin ? "bg-accent/70 text-primary" : "bg-muted text-muted-foreground"}`}>
        <LinkIcon className="h-2.5 w-2.5" />
      </div>
      {enriched && (
        <div title="Company enriched" className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-100 text-purple-600">
          <Building2 className="h-2.5 w-2.5" />
        </div>
      )}
      {review && (
        <div title="Open review flag" className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <AlertTriangle className="h-2.5 w-2.5" />
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({ band }: { band: string | null }) {
  if (!band || band === "Low") return null;
  const pct = band === "High" ? "w-full bg-emerald-500" : "w-2/3 bg-amber-500";
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full transition-all ${pct}`} />
    </div>
  );
}

export function ContactWorkspaceTable({
  workspace,
  query,
  selectedContactId,
  campaigns,
  assignableMembers = [],
  canAssign = false,
}: {
  workspace: ContactsWorkspace;
  query: Record<string, string | string[]>;
  selectedContactId?: string;
  campaigns: CampaignOption[];
  assignableMembers?: AssignableMember[];
  canAssign?: boolean;
}) {
  const empty = (
    <div className="rounded-xl border border-dashed border-hairline bg-surface p-10 text-center shadow-sm">
      <div className="text-sm font-semibold text-foreground">No contacts match this view</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Adjust the search/filters, or add contact-level lead assignments via upload.
      </p>
    </div>
  );

  if (workspace.contacts.length === 0) {
    return empty;
  }

  const selectableLeadIds = workspace.contacts
    .map((c) => c.primaryLeadAssignmentId)
    .filter((id): id is string => Boolean(id));

  const columns: DataTableColumn<ContactsWorkspace["contacts"][number]>[] = [
    {
      key: "sel",
      header: <LeadSelectAllCheckbox ids={selectableLeadIds} />,
      width: "w-10",
      cell: (contact) => {
        const leadId = contact.primaryLeadAssignmentId;
        return leadId ? (
          <LeadRowCheckbox leadAssignmentId={leadId} />
        ) : (
          <input
            type="checkbox"
            disabled
            className="h-4 w-4 cursor-not-allowed rounded border-hairline opacity-50 bg-secondary"
          />
        );
      },
    },
    {
      key: "contact",
      header: "Contact",
      cell: (contact) => (
        <Link href={contactDrawerHref(contact.id)} className="group/link block">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary ring-1 ring-primary/15">
              {contact.fullName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate font-bold text-foreground group-hover/link:text-primary transition-colors">
                {contact.fullName}
              </span>
              <span className="block truncate text-xs text-muted-foreground mb-1">
                {contact.title ?? "—"}
              </span>
              <SeniorityPill tier={contact.seniorityTier} department={contact.department} />
            </div>
          </div>
        </Link>
      ),
    },
    {
      key: "signals",
      header: "Signals",
      align: "center",
      cell: (contact) => {
        const hasLinkedin = Boolean(contact.linkedInUrl);
        const hasReview = contact.managerReviewStatus === "OPEN" || contact.managerReviewStatus === "IN_PROGRESS";
        return (
          <div className="flex justify-center pt-1">
            <SignalIcons
              email={contact.emailPresent}
              linkedin={hasLinkedin}
              enriched={Boolean(contact.primaryLeadAssignmentId)}
              review={hasReview}
            />
          </div>
        );
      },
    },
    {
      key: "company",
      header: "Company",
      cell: (contact) => (
        <div className="pt-1 font-semibold text-foreground/90">
          {contact.companyName ?? <span className="font-medium text-muted-foreground italic">Unlinked</span>}
        </div>
      ),
    },
    {
      key: "qualification",
      header: "Qualification",
      cell: (contact) => (
        <div className="pt-0.5">
          {contact.qualification && QUALIFICATIONS.has(contact.qualification) ? (
            <div className="w-fit">
              <QualificationBadge qualification={contact.qualification as LeadWorkspaceQualification} />
              <ConfidenceBar band={contact.confidenceBand} />
            </div>
          ) : (
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground border border-border/50">
              Unscored
            </span>
          )}
        </div>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (contact) => {
        const leadId = contact.primaryLeadAssignmentId;
        return (
          <div className="pt-0.5">
            {contact.ownerName ? (
              <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground border border-border/50">
                {contact.ownerName}
              </span>
            ) : canAssign && leadId ? (
              <AssignOwnerDialog
                leadAssignmentId={leadId}
                members={assignableMembers}
                onAssign={assignOwnerAction}
                compact
              />
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        );
      },
    },
    {
      key: "activeSeq",
      header: "Campaign seq",
      align: "center",
      cell: (contact) => (
        <div className="pt-1 font-semibold text-foreground">
          {contact.activeEnrollmentCount > 0 ? (
            <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">
              {contact.activeEnrollmentCount}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (contact) => {
        const leadId = contact.primaryLeadAssignmentId;
        const canEmail = Boolean(leadId && contact.emailPresent);
        return (
          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            {leadId ? (
              <>
                <Button asChild size="sm" variant="ghost" className="h-8 cursor-pointer px-2 text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary">
                  <Link href={leadDrawerHref(leadId)}><Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Lead</Link>
                </Button>
                {canEmail ? (
                  <Button asChild size="sm" variant="outline" className="h-8 cursor-pointer px-2 shadow-sm">
                    <Link href={composeHref(leadId)}><Send className="mr-1 h-3 w-3 text-primary" aria-hidden="true" />Email</Link>
                  </Button>
                ) : null}
                <AddToCampaignDialog leadAssignmentIds={canEmail ? [leadId] : []} campaigns={campaigns} />
              </>
            ) : (
              <Button asChild size="sm" variant="outline" className="h-8 cursor-pointer px-2 shadow-sm border-dashed text-muted-foreground">
                <Link href="/v2/ingestion/uploads">Assign lead</Link>
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const footer = workspace.pagination ? (
    <DataTablePagination
      page={workspace.pagination.page}
      totalPages={workspace.pagination.totalPages}
      label={`${formatCount(workspace.pagination.total)} contacts`}
      previousHref={buildHref(query, { page: String(Math.max(1, workspace.pagination.page - 1)) })}
      nextHref={buildHref(query, { page: String(Math.min(workspace.pagination.totalPages, workspace.pagination.page + 1)) })}
    />
  ) : undefined;

  return (
    <>
      <RouteListKeyboard
        hrefs={workspace.contacts.map((c) => contactDrawerHref(c.id))}
        ids={workspace.contacts.map((c) => c.id)}
        activeId={selectedContactId}
      />
      <DataTable
        columns={columns}
        rows={workspace.contacts}
        getRowId={(contact) => contact.id}
        selectedId={selectedContactId}
        minWidth="min-w-[1050px]"
        footer={footer}
        empty={empty}
        className="h-full border-none shadow-none rounded-none"
      />
    </>
  );
}
