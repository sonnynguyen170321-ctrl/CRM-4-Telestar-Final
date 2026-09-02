"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Check, X, Search, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AssignableMember = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
};

type AssignOwnerDialogProps = {
  leadAssignmentId: string;
  currentOwnerName?: string | null;
  members: AssignableMember[];
  /** Server action: (leadAssignmentId, ownerUserId | null) => Promise<{ kind: string }> */
  onAssign: (leadAssignmentId: string, ownerUserId: string | null) => Promise<{ kind: string }>;
  /** Compact trigger (table inline) vs full button */
  compact?: boolean;
};

export function AssignOwnerDialog({
  leadAssignmentId,
  currentOwnerName,
  members,
  onAssign,
  compact = false,
}: AssignOwnerDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const router = useRouter();
  const dialogRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        (m.name?.toLowerCase().includes(q)) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [members, search]);

  async function handleSelect(ownerUserId: string | null) {
    setPending(true);
    try {
      await onAssign(leadAssignmentId, ownerUserId);
      router.refresh();
      setOpen(false);
      setSearch("");
    } finally {
      setPending(false);
    }
  }

  const trigger = compact ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-all duration-200 hover:border-primary/20 hover:bg-accent hover:text-primary"
      id={`assign-owner-trigger-${leadAssignmentId}`}
    >
      <UserPlus className="h-3 w-3" aria-hidden="true" />
      Assign
    </button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="h-9 gap-2 border-border bg-white font-semibold text-foreground shadow-sm hover:bg-muted/40"
      id={`assign-owner-trigger-${leadAssignmentId}`}
    >
      <UserPlus className="h-4 w-4" aria-hidden="true" />
      {currentOwnerName ? "Reassign" : "Assign owner"}
    </Button>
  );

  if (!open) return trigger;

  return (
    <div className="relative inline-block">
      {trigger}
      <div
        ref={dialogRef}
        className="absolute right-0 top-full z-50 mt-1.5 w-72 animate-in fade-in slide-in-from-top-1 rounded-xl border border-border bg-white shadow-xl"
        role="dialog"
        aria-label="Assign owner"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Assign owner
          </span>
          <button
            type="button"
            onClick={() => { setOpen(false); setSearch(""); }}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team members..."
              className="h-8 pl-8 text-xs"
              autoFocus
            />
          </div>
        </div>

        {/* Options */}
        <div className="max-h-52 overflow-y-auto p-1.5">
          {pending ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
          ) : (
            <>
              {/* Unassign option */}
              {currentOwnerName && (
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-red-50"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50">
                    <UserX className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-red-600">Unassign</span>
                    <span className="block text-[10px] text-muted-foreground">Remove current owner</span>
                  </span>
                </button>
              )}

              {filtered.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No members found
                </div>
              ) : (
                filtered.map((member) => (
                  <button
                    key={member.userId}
                    type="button"
                    onClick={() => handleSelect(member.userId)}
                    className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent"
                    id={`assign-member-${member.userId}`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-gradient-to-br from-muted to-muted text-[10px] font-bold text-muted-foreground transition-all group-hover:border-primary/20 group-hover:from-primary/10 group-hover:to-primary/10 group-hover:text-primary">
                      {(member.name ?? member.email).charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-foreground group-hover:text-primary">
                        {member.name ?? member.email}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {member.email} · {member.role}
                      </span>
                    </span>
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export type AssignOwnersSummary = {
  requested: number;
  assigned: number;
  noChange: number;
  notFound: number;
  invalidAssignee: number;
};

type BulkAssignOwnerDialogProps = {
  leadAssignmentIds: string[];
  members: AssignableMember[];
  onAssign: (leadAssignmentIds: string[], ownerUserId: string | null) => Promise<AssignOwnersSummary>;
  onDone?: () => void;
};

export function BulkAssignOwnerDialog({
  leadAssignmentIds,
  members,
  onAssign,
  onDone,
}: BulkAssignOwnerDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [summary, setSummary] = React.useState<AssignOwnersSummary | null>(null);
  const router = useRouter();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const count = leadAssignmentIds.length;

  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const filtered = React.useMemo(() => {
    const assignable = members.filter((m) => m.role !== "VIEWER");
    if (!search.trim()) return assignable;
    const q = search.toLowerCase();
    return assignable.filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [members, search]);

  async function handleSelect(ownerUserId: string | null) {
    setPending(true);
    try {
      const result = await onAssign(leadAssignmentIds, ownerUserId);
      router.refresh();
      setSummary(result);
    } finally {
      setPending(false);
    }
  }

  function close() {
    const shouldClearSelection = Boolean(summary);
    setOpen(false);
    setSearch("");
    setSummary(null);
    if (shouldClearSelection) onDone?.();
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      disabled={count === 0}
      className="h-9 cursor-pointer gap-2 border-primary/20 bg-accent px-4 font-semibold text-primary shadow-sm transition-colors hover:bg-accent/70 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <UserPlus className="h-4 w-4" aria-hidden="true" />
      Assign owner
    </Button>
  );

  if (!open) return trigger;

  return (
    <div className="relative inline-block">
      {trigger}
      <div
        ref={dialogRef}
        className="absolute left-0 bottom-full z-50 mb-2 w-80 animate-in fade-in slide-in-from-bottom-1 rounded-xl border border-border bg-white shadow-xl"
        role="dialog"
        aria-label="Bulk assign owner"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-foreground">Assign owner</div>
            <div className="text-[11px] text-muted-foreground">{count} selected lead{count === 1 ? "" : "s"}</div>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground" aria-label="Close assign owner">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {summary ? (
          <div className="space-y-3 p-3 text-sm">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
              <span className="font-semibold">{summary.assigned}</span> assigned, <span className="font-semibold">{summary.noChange}</span> unchanged.
              {summary.invalidAssignee || summary.notFound ? (
                <span> {summary.invalidAssignee + summary.notFound} skipped.</span>
              ) : null}
            </div>
            <button type="button" onClick={close} className="inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md bg-foreground px-3 text-sm font-medium text-white hover:bg-foreground">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-border px-3 py-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SDR or team member..." className="h-8 pl-8 text-xs" autoFocus />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto p-1.5">
              {pending ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">No assignable members found</div>
              ) : (
                filtered.map((member) => (
                  <button
                    key={member.userId}
                    type="button"
                    onClick={() => handleSelect(member.userId)}
                    className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-gradient-to-br from-muted to-muted text-[10px] font-bold text-muted-foreground transition-all group-hover:border-primary/20 group-hover:from-primary/10 group-hover:to-primary/10 group-hover:text-primary">
                      {(member.name ?? member.email).charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-foreground group-hover:text-primary">{member.name ?? member.email}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{member.email} - {member.role}</span>
                    </span>
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

