"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, Target, X } from "lucide-react";

// Contacts to Leads flow. Selecting contacts then "Add to Leads" picks an
// Account -> Project -> ICP, ensures an ICP assignment for each selected
// contact, scores it against that ICP, then sends SDR work to /v2/workspace/leads.

export type IcpVersionNode = {
  id: string;
  versionNumber: number;
  status: string;
  icpProfileName: string;
};
export type ProjectNode = { id: string; name: string; icpVersions: IcpVersionNode[] };
export type AccountNode = { id: string; name: string; projects: ProjectNode[] };

type Summary = { requested: number; created: number; existing: number };

export function AssignContactsToIcpDialog({
  leadAssignmentIds,
  accounts,
  onDone,
}: {
  leadAssignmentIds: string[];
  accounts: AccountNode[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [icpVersionId, setIcpVersionId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const count = leadAssignmentIds.length;

  // Cheap O(n) finds over small in-memory lists - no memo needed.
  const account = accounts.find((a) => a.id === accountId);
  const projects = account?.projects ?? [];
  const project = projects.find((p) => p.id === projectId);
  const icpVersions = (project?.icpVersions ?? []).filter((v) => v.status === "PUBLISHED");
  const noAccounts = accounts.length === 0;
  const canSubmit = count > 0 && icpVersionId && !pending;

  function reset() {
    setError(null);
    setSummary(null);
  }

  function submit() {
    reset();
    startTransition(async () => {
      try {
        const res = await fetch("/v2/workspace/leads/score-icp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetIcpVersionId: icpVersionId, leadAssignmentIds }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          setError(body.message ?? "Could not add contacts to leads.");
          return;
        }
        setSummary(body.result as Summary);
        router.refresh();
        onDone?.();
      } catch {
        setError("Request failed.");
      }
    });
  }

  function close() {
    setOpen(false);
    setAccountId("");
    setProjectId("");
    setIcpVersionId("");
    reset();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={count === 0}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        Add to Leads
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-foreground/40" onClick={close} />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Add {count} contact{count === 1 ? "" : "s"} to Leads</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Pick the Account, Project, and ICP. An ICP assignment is created
                  for each (idempotent) and scored against the ICP, then you work them in Leads.
                </p>
              </div>
              <button type="button" onClick={close} className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground" aria-label="Close dialog">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {summary ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>
                    Added <span className="font-semibold">{summary.requested}</span> contact
                    {summary.requested === 1 ? "" : "s"} to Leads ({summary.created} new, {summary.existing} reused).
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/v2/workspace/leads?icpVersionId=${encodeURIComponent(icpVersionId)}`}
                    className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground"
                  >
                    View in Leads <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <button type="button" onClick={close} className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <CascadeSelect
                  label="Account"
                  value={accountId}
                  placeholder={noAccounts ? "No accounts" : "Select an account"}
                  disabled={noAccounts}
                  options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(value) => {
                    setAccountId(value);
                    setProjectId("");
                    setIcpVersionId("");
                  }}
                />
                <CascadeSelect
                  label="Project"
                  value={projectId}
                  placeholder={account ? "Select a project" : "Pick an account first"}
                  disabled={!account}
                  options={projects.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(value) => {
                    setProjectId(value);
                    setIcpVersionId("");
                  }}
                />
                <CascadeSelect
                  label="ICP version"
                  value={icpVersionId}
                  placeholder={project ? (icpVersions.length ? "Select a published ICP" : "No published ICP") : "Pick a project first"}
                  disabled={!project || icpVersions.length === 0}
                  options={icpVersions.map((v) => ({ value: v.id, label: `${v.icpProfileName} v${v.versionNumber}` }))}
                  onChange={setIcpVersionId}
                />

                {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
                  <button type="button" onClick={submit} disabled={!canSubmit} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Target className="h-4 w-4" aria-hidden="true" />}
                    Add {count}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function CascadeSelect({
  label,
  value,
  placeholder,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 w-full cursor-pointer rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
