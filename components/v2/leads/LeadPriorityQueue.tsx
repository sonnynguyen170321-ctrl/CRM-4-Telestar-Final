"use client";

import Link from "next/link";
import { Mail, MailX, Phone, Building2, ArrowRight, CalendarCheck, MessageSquareReply, Send, Sparkles, AlertTriangle, Link2, Target } from "lucide-react";
import type { LinkedInAccess } from "@/lib/v2/crm/contactQuality";

import { ScoreRing } from "@/components/shared/ScoreRing";
import { QualificationBadge, WorkflowBadge } from "@/components/v2/leads/AssessmentSummaryCard";
import { LeadRowCheckbox, LeadSelectAllCheckbox } from "@/components/v2/leads/LeadSelection";
import { useLeadDrawer } from "@/components/v2/leads/LeadDrawerProvider";
import { formatRelative } from "@/lib/v2/format/datetime";
import type { ContactLeadRow, ContactLeadsResult } from "@/lib/v2/crm";

// The priority-ranked queue: full-width, information-dense rows. The list is already sorted
// by priority server-side, so each row shows the ICP FIT ring (the meaningful score) plus
// identity, what the company does (intel one-liner), timely signals, and the next-best
// action. Clicking opens the focus-deck overlay. Deterministic; no per-row query.

type NextAction = { label: string; tone: "blue" | "emerald" | "amber" | "violet" | "slate" };

// The single most useful move, derived from the lead's real state (no query).
function nextAction(row: ContactLeadRow): NextAction {
  if (row.qualification === "QUALIFIED" && !row.emailUsable) return { label: "Verify channel", tone: "amber" };
  if (row.qualification === "NEEDS_REVIEW") return { label: "Review & qualify", tone: "amber" };
  switch (row.workflowStatus) {
    case "RESPONDED": return { label: "Reply now", tone: "emerald" };
    case "MEETING_BOOKED": return { label: "Prep meeting", tone: "violet" };
    case "CONTACTED": return { label: "Follow up", tone: "blue" };
    case "NEW":
    case "ASSIGNED":
      return row.qualification === "QUALIFIED" ? { label: "Start outreach", tone: "blue" } : { label: "Work lead", tone: "slate" };
    default:
      if (row.qualification === "NOT_SCORED") return { label: "Score", tone: "slate" };
      if (row.qualification === "QUALIFIED" && !row.lastTouchAt) return { label: "Start outreach", tone: "blue" };
      return { label: "Work lead", tone: "slate" };
  }
}

// Turn raw fact tokens ("category.fintech") into short human chips.
function intelChips(tokens: string[]): string[] {
  const priority = ["category.", "industry.", "offering.", "business_model.", "market.segment_"];
  const picked: string[] = [];
  for (const prefix of priority) {
    for (const t of tokens) {
      if (t.startsWith(prefix) && !picked.includes(t)) picked.push(t);
      if (picked.length >= 2) break;
    }
    if (picked.length >= 2) break;
  }
  return picked.slice(0, 2).map((t) => t.slice(t.indexOf(".") + 1).replace(/_/g, " "));
}

export function LeadPriorityQueue({
  result,
  query,
}: {
  result: ContactLeadsResult;
  query: Record<string, string>;
}) {
  const { snapshot, open } = useLeadDrawer();
  const selectedId = snapshot?.leadAssignmentId ?? null;

  if (result.rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-hairline bg-surface p-8 text-center shadow-sm">
        <div className="text-sm font-medium text-foreground">No leads match this view</div>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Adjust the filters, or open <Link href="/v2/crm/companies" className="font-medium text-primary hover:text-primary">Companies</Link> for company-level leads with no contact.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-sm">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <LeadSelectAllCheckbox ids={result.rows.map(r => r.leadAssignmentId)} />
        <span>Ranked by priority</span>
      </div>
      <ul className="flex-1 flex flex-col gap-3 overflow-y-auto p-3 bg-muted/50 dark:bg-background/50">
        {result.rows.map((row) => (
          <QueueRow
            key={row.contactId}
            row={row}
            selected={row.leadAssignmentId === selectedId}
            onOpen={() =>
              open({
                leadAssignmentId: row.leadAssignmentId,
                contactName: row.contactName,
                contactTitle: row.contactTitle ?? row.seniorityTier,
                companyName: row.companyName,
              })
            }
          />
        ))}
      </ul>
      <QueueFooter result={result} query={query} />
    </div>
  );
}


function contactabilityLabel(status: ContactLeadRow["contactabilityStatus"]): string {
  switch (status) {
    case "ready": return "Ready";
    case "review": return "Review channel";
    case "linkedin_only": return "LinkedIn only";
    case "company_phone": return "Company phone";
    default: return "No channel";
  }
}
function QueueRow({ row, selected, onOpen }: { row: ContactLeadRow; selected: boolean; onOpen: () => void }) {
  const chips = intelChips(row.companyFactTokens);
  const action = nextAction(row);
  const displayName = row.contactName ?? "Company-level lead";
  const avatarInitials = displayName.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();

  return (
    <li className={`shrink-0 group relative rounded-xl border transition-colors duration-200 overflow-hidden ${
      selected
        ? "border-primary ring-1 ring-primary/20 bg-surface shadow-sm"
        : "border-hairline bg-surface hover:border-primary/30 hover:bg-muted/20 shadow-sm"
    }`}>
      <div className="flex items-stretch relative z-10">
        {/* Checkbox Column */}
        <div className="flex shrink-0 items-start pl-4 pt-5">
          <LeadRowCheckbox leadAssignmentId={row.leadAssignmentId} />
        </div>

        {/* Clickable Content Area */}
        <div
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-4 px-4 py-4 text-left cursor-pointer select-none"
        >
          {/* Fit ring & Avatar */}
          <div className="flex w-12 shrink-0 flex-col items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary ring-1 ring-primary/15">
              {avatarInitials}
            </div>
            {row.fitScore !== null ? (
              <ScoreRing score={row.fitScore} size="sm" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-hairline text-[8px] font-medium uppercase text-muted-foreground">n/s</span>
            )}
          </div>

          {/* Identity + company + intel */}
          <div className="min-w-0 flex-1 space-y-2">
            {/* Header Row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="truncate text-[15px] font-bold text-foreground group-hover:text-primary transition-colors max-w-[200px] sm:max-w-xs">{displayName}</span>
              {row.emailUsable ? <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <MailX className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />}
              {row.phone ? <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
              <QualificationBadge qualification={row.qualification} />
              <WorkflowBadge workflowStatus={row.workflowStatus} />
            </div>

            {/* Details Row */}
            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground/80">{row.contactTitle ?? row.seniorityTier}</span>
              <span className="text-hairline">|</span>
              <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="font-semibold text-foreground/90">{row.companyName}</span>
              {row.companyDomain ? <span className="text-muted-foreground/70">{row.companyDomain}</span> : null}
            </div>

            {/* Rich Insight Box */}
            {(row.companySummary || row.reason) && (
              <div className="mt-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 flex items-start gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
                <p className="text-[13px] text-foreground/80 leading-relaxed">
                  {row.companySummary ? row.companySummary : <span className="italic">{row.reason}</span>}
                </p>
              </div>
            )}

            {/* Signals */}
            <div className="pt-1 flex flex-wrap items-center gap-1.5">
              {chips.map((chip, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground border border-border/50 shadow-sm">
                  <Target className="h-3 w-3 opacity-70" aria-hidden="true" />{chip}
                </span>
              ))}
              {row.meetingStatus !== "NONE" ? <SignalPill tone="violet" icon={<CalendarCheck className="h-3 w-3" />}>{row.meetingStatus === "DONE" ? "Met" : "Meeting"}</SignalPill> : null}
              {row.workflowStatus === "RESPONDED" ? <SignalPill tone="emerald" icon={<MessageSquareReply className="h-3 w-3" />}>Replied</SignalPill> : null}
              {row.activeEnrollmentCount > 0 ? <SignalPill tone="blue" icon={<Send className="h-3 w-3" />}>{row.activeEnrollmentCount} running sequence</SignalPill> : null}
              {linkedInWarnChip(row.linkedInAccess)}
              {!row.emailUsable ? <SignalPill tone="amber" icon={<AlertTriangle className="h-3 w-3" />}>{contactabilityLabel(row.contactabilityStatus)}</SignalPill> : null}
            </div>
          </div>
        </div>

        {/* Action Column (Non-clickable for drawer) */}
        <div className="hidden w-48 shrink-0 flex flex-col items-end justify-center gap-2 pr-6 pl-4 border-l border-hairline bg-muted/30 dark:bg-background/10 sm:flex">
          <span className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/90">
            {action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="text-right text-[11px] text-muted-foreground flex flex-col gap-0.5">
            {row.ownerName ? <span className="font-medium text-foreground/80">{row.ownerName}</span> : <span>Unassigned</span>}
            <span suppressHydrationWarning>{row.lastTouchAt ? formatRelative(row.lastTouchAt) : "No touch"}</span>
            {row.createdAt ? (
              <span suppressHydrationWarning className="text-muted-foreground/75" title={new Date(row.createdAt).toLocaleString()}>
                Added {formatRelative(row.createdAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function SignalPill({ tone, icon, children }: { tone: "violet" | "emerald" | "blue" | "amber"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    blue: "bg-accent text-primary",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{icon}{children}</span>;
}

function linkedInWarnChip(access: LinkedInAccess) {
  if (access === "NOT_FOUND") return <SignalPill tone="amber" icon={<Link2 className="h-2.5 w-2.5" aria-hidden="true" />}>LinkedIn 404</SignalPill>;
  if (access === "PRIVATE") return <SignalPill tone="amber" icon={<Link2 className="h-2.5 w-2.5" aria-hidden="true" />}>LinkedIn private</SignalPill>;
  if (access === "MALFORMED") return <SignalPill tone="amber" icon={<Link2 className="h-2.5 w-2.5" aria-hidden="true" />}>Bad LinkedIn</SignalPill>;
  return null;
}

function QueueFooter({ result, query }: { result: ContactLeadsResult; query: Record<string, string> }) {
  const { page, totalPages, total } = result.pagination;
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
      <span>
        Page {page}/{totalPages} · {total.toLocaleString("en-US")} leads
      </span>
      <div className="flex items-center gap-1.5">
        <PageLink query={query} page={Math.max(1, page - 1)} disabled={page <= 1}>
          Prev
        </PageLink>
        <PageLink query={query} page={Math.min(totalPages, page + 1)} disabled={page >= totalPages}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({ query, page, disabled, children }: { query: Record<string, string>; page: number; disabled: boolean; children: React.ReactNode }) {
  const params = new URLSearchParams(query);
  params.set("page", String(page));
  const href = `/v2/workspace/leads?${params.toString()}`;
  if (disabled) {
    return <span className="cursor-not-allowed rounded border border-hairline px-2 py-1 font-medium text-muted-foreground opacity-50">{children}</span>;
  }
  return (
    <Link href={href} prefetch className="rounded border border-hairline px-2 py-1 font-medium text-foreground hover:bg-surface-raised transition-colors">
      {children}
    </Link>
  );
}
