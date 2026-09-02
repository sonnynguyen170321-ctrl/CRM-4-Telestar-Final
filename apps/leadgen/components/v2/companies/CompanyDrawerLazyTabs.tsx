"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { composeHref } from "@/lib/v2/crm/leadRoutes";
import { formatDateTime } from "@/lib/v2/format/datetime";
import type { CompanyContact, CompanyActivity } from "@/lib/v2/company-intelligence/companyTabs";
import type { CompanyResearchHistoryEntry } from "@/lib/v2/company-intelligence/readModel";

type LoadState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

export function LazyCompanyContacts({ companyId }: { companyId: string }) {
  const state = useCompanyDrawerTab<{ contacts: CompanyContact[] }>(companyId, "contacts");
  if (state.status !== "ready") return <LazyState state={state} label="contacts" />;
  const contacts = state.data.contacts;

  if (contacts.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">No contacts are linked to this company yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Contact</th>
            <th className="px-4 py-2.5 font-medium">Seniority</th>
            <th className="px-4 py-2.5 font-medium">Email</th>
            <th className="px-4 py-2.5 text-right font-medium">LAs</th>
            <th className="px-4 py-2.5 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {contacts.map((ct) => (
            <tr key={ct.id} className="transition-colors hover:bg-muted/40">
              <td className="px-4 py-3">
                <div className="font-medium text-foreground">{ct.fullName}</div>
                <div className="text-xs text-muted-foreground">{ct.title ?? ct.department}</div>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{ct.seniorityTier}</span>
              </td>
              <td className="px-4 py-3">
                {ct.email ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3 text-muted-foreground" aria-hidden="true" />{ct.email}</span>
                ) : <span className="text-xs text-muted-foreground">No email</span>}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{ct.leadAssignmentCount}</td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex items-center gap-3">
                  {ct.primaryLeadAssignmentId && ct.email ? (
                    <Link href={composeHref(ct.primaryLeadAssignmentId)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"><Mail className="h-3 w-3" aria-hidden="true" />Compose</Link>
                  ) : null}
                  <Link href={`/v2/crm/contacts?contactId=${ct.id}`} className="text-xs font-medium text-muted-foreground hover:text-foreground">Open</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LazyCompanyActivity({ companyId }: { companyId: string }) {
  const state = useCompanyDrawerTab<{ activity: CompanyActivity[] }>(companyId, "activity");
  if (state.status !== "ready") return <LazyState state={state} label="activity" />;
  const activity = state.data.activity;

  if (activity.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No outreach activity yet. Sends, replies, and bounces appear here once this company&apos;s leads are contacted.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {activity.map((event) => (
        <li key={event.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {formatLabel(event.eventKind)}
              <span className="ml-2 font-normal text-muted-foreground">{event.channel}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">{event.contactName ?? "Company-level"}</div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <time className="text-xs text-muted-foreground" dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
            <Link href={`/v2/workspace/leads?selectedLeadId=${event.leadAssignmentId}`} className="text-xs font-medium text-primary hover:text-primary/80">Lead</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LazyCompanyResearchHistory({ companyId }: { companyId: string }) {
  const state = useCompanyDrawerTab<{ researchHistory: CompanyResearchHistoryEntry[] }>(companyId, "history");
  if (state.status !== "ready") return <LazyState state={state} label="research history" />;
  const researchHistory = state.data.researchHistory;

  if (researchHistory.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No research timeline entries yet.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {researchHistory.map((entry) => (
        <li key={`${entry.kind}-${entry.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">
              {entry.kind === "profile" ? "Intelligence build" : "Website crawl"} v{entry.researchVersion}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">{formatLabel(entry.status)}</span>
            {entry.isLive ? <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">LIVE</span> : null}
          </div>
          <time className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.createdAt)}</time>
        </li>
      ))}
    </ul>
  );
}

function useCompanyDrawerTab<T>(companyId: string, tab: string): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "loading", data: null, error: null });

  useEffect(() => {
    let active = true;
    // Reset to loading on tab/company change before the fetch — intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading", data: null, error: null });
    fetch(`/v2/crm/companies/${companyId}/drawer-tabs?tab=${tab}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load ${tab}`);
        return (await res.json()) as T;
      })
      .then((data) => {
        if (active) setState({ status: "ready", data, error: null });
      })
      .catch((error) => {
        if (active) setState({ status: "error", data: null, error: error instanceof Error ? error.message : "Failed to load" });
      });
    return () => {
      active = false;
    };
  }, [companyId, tab]);

  return state;
}

function LazyState<T>({ state, label }: { state: LoadState<T>; label: string }) {
  if (state.status === "error") {
    return <div className="px-4 py-8 text-center text-sm text-red-600">{state.error}</div>;
  }
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" /> Loading {label}...
    </div>
  );
}

function formatLabel(value: string): string {
  return value.replace(/^outreach\./, "").split(/[._\s]+/).map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part)).join(" ");
}

function formatDate(value: string): string {
  return formatDateTime(value, value);
}
