import Link from "next/link";
import { X, ListChecks, Flame, AlarmClock, CalendarClock, CheckCircle2, Lightbulb, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { Badge } from "@/components/ui/badge";
import type { ManagerReviewQueueRow, QueryReviewQueueResult } from "@/lib/v2/manager-review";
import type { LeadWorkspaceDetail } from "@/lib/v2/crm";

import { ReviewResolutionPanel } from "./ReviewResolutionPanel";
import { ReviewLeadContext } from "./ReviewLeadContext";
import { CompanyIntelligencePanel } from "@/components/v2/company-intelligence/CompanyIntelligencePanel";
import { presentCompanyIntelligence } from "@telestar/core-intel/presentIntelligence";

const ACTIVE_REVIEW_STATUSES = new Set(["OPEN", "IN_PROGRESS", "SNOOZED"]);

type ReviewQueueWorkspaceProps = {
  result: QueryReviewQueueResult;
  selectedReviewId?: string;
  selectedLeadDetail?: LeadWorkspaceDetail | null;
  sourceFilter?: string;
  priorityFilter?: string;
  nowMs: number;
  endOfTodayMs: number;
};

export function ReviewQueueWorkspace({
  result,
  selectedReviewId,
  selectedLeadDetail,
  sourceFilter,
  priorityFilter,
  nowMs,
  endOfTodayMs,
}: ReviewQueueWorkspaceProps) {
  const matchesFilter = (row: ManagerReviewQueueRow) =>
    (!sourceFilter || row.item.sourceType === sourceFilter) &&
    (!priorityFilter || row.item.priority === priorityFilter);
  const activeRows = result.rows.filter(
    (row) => ACTIVE_REVIEW_STATUSES.has(row.item.status) && matchesFilter(row)
  );
  const resolvedRows = result.rows.filter(
    (row) => !ACTIVE_REVIEW_STATUSES.has(row.item.status) && matchesFilter(row)
  );
  // Distinct facet values from the loaded items (any status) for the chip bar.
  const sourceOptions = Array.from(new Set(result.rows.map((r) => r.item.sourceType)));
  const priorityOptions = Array.from(new Set(result.rows.map((r) => r.item.priority)));

  const selected =
    result.rows.find((row) => row.item.id === selectedReviewId) ?? null;

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        eyebrow="Review queue"
        title="Review queue"
        description="Review what the tool couldn't auto-decide — flagged activity-recap rows and NEEDS_REVIEW leads. Approve, link, request changes, dismiss, or convert to feedback. Resolutions write audit events and never mutate assessments."
        actions={
          <div className="rounded-lg border border-hairline bg-secondary px-3 py-2 text-xs font-semibold text-muted-foreground shadow-premium">
            {activeRows.length} active
            {resolvedRows.length > 0 ? ` · ${resolvedRows.length} resolved` : ""}
          </div>
        }
      />
      <main className="space-y-5 px-6 py-5">
      <ReviewStatStrip
        rows={result.rows}
        nowMs={nowMs}
        endOfTodayMs={endOfTodayMs}
      />
      <ReviewFilterBar
        sourceOptions={sourceOptions}
        priorityOptions={priorityOptions}
        sourceFilter={sourceFilter}
        priorityFilter={priorityFilter}
      />
        <section className="min-w-0 space-y-5">
          {activeRows.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-premium">
              <div className="grid grid-cols-[1.3fr_1fr_0.8fr_0.8fr] gap-3 border-b border-hairline bg-background/50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <div>Review</div>
                <div>Lead context</div>
                <div>Status</div>
                <div>Priority</div>
              </div>
              <div className="divide-y divide-hairline">
                {activeRows.map((row) => (
                  <ReviewRow
                    key={row.item.id}
                    row={row}
                    selected={row.item.id === selected?.item.id}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-hairline bg-surface p-8 text-center shadow-premium">
              <div className="text-sm font-semibold text-foreground">
                No active review items
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Nothing needs a decision right now. Scoring, ingestion, and
                activity-recap ambiguity flows create new review items here.
              </p>
            </div>
          )}

          {resolvedRows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-premium">
              <div className="border-b border-hairline bg-background/50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Recently resolved
              </div>
              <div className="divide-y divide-hairline">
                {resolvedRows.map((row) => (
                  <ReviewRow
                    key={row.item.id}
                    row={row}
                    selected={row.item.id === selected?.item.id}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
      {selected ? <ReviewDetail row={selected} leadDetail={selectedLeadDetail ?? null} /> : null}
    </WorkspaceFrame>
  );
}

function ReviewFilterBar({
  sourceOptions,
  priorityOptions,
  sourceFilter,
  priorityFilter,
}: {
  sourceOptions: string[];
  priorityOptions: string[];
  sourceFilter?: string;
  priorityFilter?: string;
}) {
  if (sourceOptions.length <= 1 && priorityOptions.length <= 1) return null;
  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const source = "source" in patch ? patch.source : sourceFilter;
    const priority = "priority" in patch ? patch.priority : priorityFilter;
    if (source) params.set("source", source);
    if (priority) params.set("priority", priority);
    const qs = params.toString();
    return qs ? `/v2/reviews?${qs}` : "/v2/reviews";
  };
  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${active ? "bg-primary text-primary-foreground shadow-premium" : "bg-surface text-foreground border border-hairline hover:bg-surface-raised"}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</span>
      <Link href={href({ source: undefined })} className={chip(!sourceFilter)}>All</Link>
      {sourceOptions.map((s) => (
        <Link key={s} href={href({ source: s })} className={chip(sourceFilter === s)}>{formatLabel(s)}</Link>
      ))}
      <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Priority</span>
      <Link href={href({ priority: undefined })} className={chip(!priorityFilter)}>All</Link>
      {priorityOptions.map((p) => (
        <Link key={p} href={href({ priority: p })} className={chip(priorityFilter === p)}>{formatLabel(p)}</Link>
      ))}
    </div>
  );
}

function ReviewRow({
  row,
  selected,
}: {
  row: ManagerReviewQueueRow;
  selected: boolean;
}) {
  return (
    <Link
      href={`/v2/reviews?reviewItemId=${row.item.id}`}
      className={`grid cursor-pointer grid-cols-[1.3fr_1fr_0.8fr_0.8fr] gap-3 px-4 py-3 text-sm transition-colors duration-200 ${
        selected ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-surface-raised"
      }`}
    >
      <div className="min-w-0">
        <div className="truncate font-semibold text-foreground">
          {formatLabel(row.item.reasonCode)}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatLabel(row.item.sourceType)} / {row.item.suggestedAction ?? "No suggested action"}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold text-foreground/80">
          {row.context.company?.name ?? "No company context"}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {row.context.contact?.fullName ??
            row.context.leadAssignment?.assignmentLevel ??
            "No linked lead"}
        </div>
      </div>
      <div>
        <ReviewBadge value={row.item.status} tone="status" />
      </div>
      <div>
        <ReviewBadge value={row.item.priority} tone="priority" />
      </div>
    </Link>
  );
}

function ReviewDetail({
  row,
  leadDetail,
}: {
  row: ManagerReviewQueueRow;
  leadDetail: LeadWorkspaceDetail | null;
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-hairline bg-surface/95 backdrop-blur-2xl shadow-2xl">
      <div className="border-b border-hairline bg-background/50 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
              Selected review
            </div>
            <h2 className="mt-1 break-words text-lg font-bold text-foreground">
              {formatLabel(row.item.reasonCode)}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <ReviewBadge value={row.item.status} tone="status" />
              <ReviewBadge value={row.item.priority} tone="priority" />
              <ReviewBadge value={row.item.confidence} tone="neutral" />
            </div>
          </div>
          <Link
            href="/v2/reviews"
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-hairline px-3 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-surface-raised"
          >
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            Close
          </Link>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
      {row.item.suggestedAction ? (
        <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-primary">
              Recommended next action
            </div>
            <p className="mt-0.5 text-sm text-foreground">{row.item.suggestedAction}</p>
          </div>
        </div>
      ) : null}

      {row.item.reasonDetail ? (
        <div className="rounded-xl border border-hairline bg-secondary/50 p-3 text-sm text-muted-foreground">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why this needs review
          </div>
          <p className="mt-1">{row.item.reasonDetail}</p>
        </div>
      ) : null}

        {leadDetail ? <ReviewLeadContext detail={leadDetail} /> : null}

        {/* Same shared intelligence presenter the SDR + Company drawer see, so a
            reviewer qualifies with the company's actual offering/buyers in view. */}
        {leadDetail ? (
          <CompanyIntelligencePanel view={presentCompanyIntelligence(leadDetail.companyIntelligence)} />
        ) : null}

        <CandidateRecords value={row.item.candidateSummariesJson} />

        <DefinitionList
          rows={[
            ["Source", formatLabel(row.item.sourceType)],
            ["Source ID", row.item.sourceId ?? "Not recorded"],
            ["Created", formatDateTime(row.item.createdAt)],
            ["Due", row.item.dueAt ? formatDateTime(row.item.dueAt) : "No due date"],
            ["Assigned to", row.context.assignee?.emailNormalized ?? "Unassigned"],
          ]}
        />
        <ContextBlock row={row} />
      </div>

      <div className="border-t border-hairline bg-surface/95 p-5 shadow-premium">
        {ACTIVE_REVIEW_STATUSES.has(row.item.status) ? (
          <ReviewResolutionPanel reviewItemId={row.item.id} />
        ) : (
          <ResolvedSummary row={row} />
        )}
      </div>
    </aside>
  );
}

function CandidateRecords({ value }: { value: unknown }) {
  const candidates = parseCandidates(value);

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-foreground">Matched candidate records</h3>
      <div className="space-y-2">
        {candidates.map((candidate, index) => (
          <div
            key={`${candidate.label}-${index}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface p-3 shadow-premium"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{candidate.label}</div>
              {candidate.detail ? (
                <div className="truncate text-xs text-muted-foreground">{candidate.detail}</div>
              ) : null}
            </div>
            {candidate.confidence !== null ? (
              <Badge variant="outline" className="border-hairline bg-secondary text-foreground">
                {candidate.confidence}
              </Badge>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseCandidates(
  value: unknown
): Array<{ label: string; detail: string | null; confidence: string | null }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Array<{ label: string; detail: string | null; confidence: string | null }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const label =
      pickStringField(record, ["name", "companyName", "label", "title"]) ?? "Candidate record";
    const detail = pickStringField(record, ["domain", "canonicalDomain", "website", "reason"]);
    const confidenceRaw = record.confidence ?? record.score;
    const confidence =
      typeof confidenceRaw === "number"
        ? String(confidenceRaw)
        : typeof confidenceRaw === "string"
          ? confidenceRaw
          : null;
    out.push({ label, detail, confidence });
  }
  return out;
}

function pickStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function ResolvedSummary({ row }: { row: ManagerReviewQueueRow }) {
  return (
    <div className="space-y-2 rounded-xl border border-hairline bg-surface p-3 text-sm shadow-premium">
      <div className="font-semibold text-foreground">
        {formatLabel(row.item.status)}
        {row.item.resolutionType
          ? ` · ${formatLabel(row.item.resolutionType)}`
          : ""}
      </div>
      {row.item.resolvedAt && (
        <div className="text-xs text-muted-foreground">
          Resolved {formatDateTime(row.item.resolvedAt)}
          {row.context.resolvedBy?.emailNormalized
            ? ` by ${row.context.resolvedBy.emailNormalized}`
            : ""}
        </div>
      )}
      {row.item.resolutionNote && (
        <p className="rounded bg-secondary p-2 text-xs text-foreground border border-hairline">
          {row.item.resolutionNote}
        </p>
      )}
    </div>
  );
}

function ContextBlock({ row }: { row: ManagerReviewQueueRow }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-foreground">Linked context</h3>
      <DefinitionList
        rows={[
          ["Company", row.context.company?.name ?? "Not linked"],
          ["Contact", row.context.contact?.fullName ?? "Not linked"],
          ["Project", row.context.project?.name ?? "Not linked"],
          [
            "ICP",
            row.context.icpVersion
              ? `${row.context.icpVersion.icpProfileName ?? "ICP"} v${row.context.icpVersion.versionNumber}`
              : "Not linked",
          ],
          [
            "Workflow",
            row.context.leadAssignment?.workflowStatus
              ? formatLabel(row.context.leadAssignment.workflowStatus)
              : "No linked lead",
          ],
          [
            "Latest score",
            row.context.latestAssessment
              ? `${row.context.latestAssessment.fitScore} / ${formatLabel(row.context.latestAssessment.qualification)}`
              : "No latest assessment",
          ],
        ]}
      />
      {row.item.leadAssignmentId && (
        <Link
          href={`/v2/workspace/leads?selectedLeadId=${row.item.leadAssignmentId}`}
          className="inline-flex text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          Open linked lead assignment
        </Link>
      )}
    </div>
  );
}

function DefinitionList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 rounded-xl border border-hairline bg-secondary/50 p-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-semibold text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewBadge({
  value,
  tone,
}: {
  value: string;
  tone: "status" | "priority" | "neutral";
}) {
  const className =
    tone === "priority" && (value === "HIGH" || value === "CRITICAL")
      ? "border-rose-500/20 bg-rose-500/10 text-rose-600"
      : tone === "status" && ["OPEN", "IN_PROGRESS", "SNOOZED"].includes(value)
        ? "border-primary/20 bg-primary/10 text-primary"
        : "border-hairline bg-secondary text-foreground";

  return (
    <Badge variant="outline" className={className}>
      {formatLabel(value)}
    </Badge>
  );
}

function ReviewStatStrip({
  rows,
  nowMs,
  endOfTodayMs,
}: {
  rows: ManagerReviewQueueRow[];
  nowMs: number;
  endOfTodayMs: number;
}) {
  const active = rows.filter((row) => ACTIVE_REVIEW_STATUSES.has(row.item.status));
  const highPriority = active.filter(
    (row) => row.item.priority === "HIGH" || row.item.priority === "CRITICAL"
  );
  const overdue = active.filter(
    (row) => row.item.dueAt !== null && new Date(row.item.dueAt).getTime() < nowMs
  );
  const dueToday = active.filter((row) => {
    if (row.item.dueAt === null) return false;
    const due = new Date(row.item.dueAt).getTime();
    return due >= nowMs && due < endOfTodayMs;
  });
  const resolved = rows.filter((row) => !ACTIVE_REVIEW_STATUSES.has(row.item.status));

  const stats: Array<{ label: string; value: number; icon: LucideIcon; tone: string }> = [
    { label: "In queue", value: active.length, icon: ListChecks, tone: "text-primary" },
    { label: "High priority", value: highPriority.length, icon: Flame, tone: "text-red-600" },
    { label: "Overdue", value: overdue.length, icon: AlarmClock, tone: "text-amber-600" },
    { label: "Due today", value: dueToday.length, icon: CalendarClock, tone: "text-violet-600" },
    { label: "Resolved", value: resolved.length, icon: CheckCircle2, tone: "text-emerald-600" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="rounded-xl border border-hairline bg-surface p-4 shadow-premium">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">{stat.label}</span>
              <Icon className={`h-4 w-4 ${stat.tone}`} aria-hidden="true" />
            </div>
            <div className={`mt-2 text-2xl font-bold tracking-tight ${stat.tone}`}>{stat.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}
