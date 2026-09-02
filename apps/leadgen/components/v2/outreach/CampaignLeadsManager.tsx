"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, Pause, Play, Search, Trash2, X } from "lucide-react";

import {
  pauseEnrollmentsAction,
  resumeEnrollmentsAction,
  removeEnrollmentsAction,
} from "@/app/v2/outreach/campaigns/[campaignId]/leads/actions";
import { EnrollmentRowDrawer } from "./EnrollmentRowDrawer";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { formatDate, formatDateTime } from "@/lib/v2/format/datetime";
import type {
  CampaignEnrollmentRow,
  CampaignEnrollmentsResult,
  EnrollmentStatus,
} from "@/lib/v2/outreach/campaigns/queryCampaignEnrollments";

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PAUSED", label: "Paused" },
  { key: "COMPLETED", label: "Completed" },
  { key: "HALTED", label: "Removed" },
];

export function CampaignLeadsManager({
  campaignId,
  result,
  status,
  search,
  isAdmin,
  inlineTab,
}: {
  campaignId: string;
  result: CampaignEnrollmentsResult;
  status: string;
  search: string;
  isAdmin: boolean;
  inlineTab?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rows = result.rows;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => (rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))));

  function runAction(fn: (campaignId: string, ids: string[]) => Promise<{ changed: number }>) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      await fn(campaignId, ids);
      setSelected(new Set());
      router.refresh();
    });
  }

  const tabHref = (key: string) => {
    const params = new URLSearchParams();
    if (inlineTab) params.set("tab", inlineTab);
    if (search) params.set("search", search);
    if (key) params.set("status", key);
    const qs = params.toString();
    return `/v2/outreach/campaigns/${campaignId}${inlineTab ? "" : "/leads"}${qs ? `?${qs}` : ""}`;
  };

  const facetFor = (key: string) =>
    key ? result.facets[key as EnrollmentStatus] ?? 0 : Object.values(result.facets).reduce((a, b) => a + b, 0);

  const count = selected.size;

  const columns: DataTableColumn<CampaignEnrollmentRow>[] = [
    ...(isAdmin
      ? [{
          key: "sel",
          width: "w-10",
          header: (
            <input type="checkbox" checked={allSelected} onChange={toggleAll} onClick={(e) => e.stopPropagation()} className="h-4 w-4 rounded border-border text-primary" aria-label="Select all" />
          ),
          cell: (row: CampaignEnrollmentRow) => (
            <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 rounded border-border text-primary" aria-label="Select lead" />
          ),
        } as DataTableColumn<CampaignEnrollmentRow>]
      : []),
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.contactName ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{row.email ?? "No email"}</div>
        </div>
      ),
    },
    { key: "company", header: "Company", cell: (row) => <span className="text-foreground">{row.companyName ?? "—"}</span> },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
    { key: "step", header: "Step", hideBelow: "sm", cell: (row) => <span className="text-muted-foreground">Step {row.currentStepOrdinal + 1}</span> },
    { key: "next", header: "Next send", hideBelow: "md", cell: (row) => <span className="text-xs text-muted-foreground">{formatDateTime(row.nextStepAt)}</span> },
    {
      key: "last",
      header: "Last message",
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.lastMessageStatus ? `${row.lastMessageStatus}${row.lastSentAt ? ` · ${formatDate(row.lastSentAt)}` : ""}` : "Not sent"}
        </span>
      ),
    },
    {
      key: "replies",
      header: "Replies",
      align: "right",
      cell: (row) =>
        row.replyCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {row.replyCount}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((tab) => {
            const active = (status || "") === tab.key;
            return (
              <Link
                key={tab.key || "all"}
                href={tabHref(tab.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active ? "border-primary/20 bg-accent text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {tab.label}
                <span className="text-muted-foreground">{facetFor(tab.key)}</span>
              </Link>
            );
          })}
        </div>
        <form action={`/v2/outreach/campaigns/${campaignId}${inlineTab ? "" : "/leads"}`} className="relative">
          {inlineTab ? <input type="hidden" name="tab" value={inlineTab} /> : null}
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            name="search"
            defaultValue={search}
            placeholder="Search contact, email, company"
            className="h-9 w-64 rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20"
          />
        </form>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => setOpenId(row.id)}
        minWidth="min-w-[900px]"
        empty={<div className="px-4 py-10 text-center text-sm text-muted-foreground">No leads match this view.</div>}
      />

      {isAdmin && count > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
            <span className="text-sm font-medium text-foreground">
              <span className="font-semibold text-foreground">{count}</span> selected
            </span>
            <div className="h-5 w-px bg-muted" />
            <BulkButton onClick={() => runAction(resumeEnrollmentsAction)} disabled={pending} icon={Play} label="Resume" tone="emerald" />
            <BulkButton onClick={() => runAction(pauseEnrollmentsAction)} disabled={pending} icon={Pause} label="Pause" tone="amber" />
            <BulkButton onClick={() => runAction(removeEnrollmentsAction)} disabled={pending} icon={Trash2} label="Remove" tone="red" />
            <button type="button" onClick={() => setSelected(new Set())} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted/50">
              <X className="h-4 w-4" /> Clear
            </button>
            {pending ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
          </div>
        </div>
      ) : null}

      {openId ? (
        <EnrollmentRowDrawer
          key={openId}
          campaignId={campaignId}
          enrollmentId={openId}
          isAdmin={isAdmin}
          onClose={() => setOpenId(null)}
          onActed={() => {
            setSelected(new Set());
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300"
      : status === "PAUSED"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300"
        : status === "COMPLETED"
          ? "border-primary/20 bg-accent text-primary"
          : "border-border bg-muted/40 text-muted-foreground";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

function BulkButton({
  onClick,
  disabled,
  icon: Icon,
  label,
  tone,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: typeof Play;
  label: string;
  tone: "emerald" | "amber" | "red";
}) {
  const cls = {
    emerald: "text-emerald-700 hover:bg-emerald-50",
    amber: "text-amber-700 hover:bg-amber-50",
    red: "text-red-700 hover:bg-red-50",
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
