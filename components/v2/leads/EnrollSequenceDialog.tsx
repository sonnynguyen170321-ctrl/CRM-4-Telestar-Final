"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

import type { EnrollmentOptions } from "@/lib/v2/outreach/sequences/queryEnrollment";

// Legacy campaign enrollment dialog. Visible surfaces should say "Add to campaign";
// the underlying implementation still picks a published campaign sequence and sender.
// It POSTs to /v2/leads/enroll, then shows the per-lead breakdown
// (enrolled / already-in / skipped) and refreshes. No send happens here - the
// enrollment runtime carries each step through the suppression gate.

type EnrollResultSummary = {
  requested: number;
  enrolled: number;
  skipped: number;
  skippedByCode?: Record<string, number>;
};

const SKIP_LABEL: Record<string, string> = {
  ALREADY_ENROLLED: "already in sequence",
  NO_CONTACT: "no contact",
  NO_CONTACT_EMAIL: "no email",
  LEAD_NOT_FOUND: "inactive lead",
  SENDER_NOT_ACTIVE: "sender inactive",
  SEQUENCE_NOT_ACTIVE: "sequence not live",
  SEQUENCE_EMPTY: "empty sequence",
};

export function EnrollSequenceDialog({
  leadAssignmentIds,
  options,
  initialSequenceId,
  triggerLabel = "Add to campaign",
  triggerClassName,
  compact = false,
  onEnrolled,
}: {
  leadAssignmentIds: string[];
  options: EnrollmentOptions;
  initialSequenceId?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  compact?: boolean;
  onEnrolled?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sequenceId, setSequenceId] = useState(
    initialSequenceId && options.sequences.some((s) => s.id === initialSequenceId) ? initialSequenceId : ""
  );
  const [senderId, setSenderId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<EnrollResultSummary | null>(null);

  const count = leadAssignmentIds.length;
  const canSubmit = count > 0 && sequenceId && senderId && !pending;
  const noSequences = options.sequences.length === 0;
  const noSenders = options.senders.length === 0;

  function submit() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      try {
        const res = await fetch("/v2/workspace/leads/enroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sequenceId, senderAccountId: senderId, leadAssignmentIds }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          setError(body.message ?? "Enrollment failed.");
          return;
        }
        setSummary(body.result as EnrollResultSummary);
        router.refresh();
        onEnrolled?.();
      } catch {
        setError("Enrollment request failed.");
      }
    });
  }

  function close() {
    setOpen(false);
    setError(null);
    setSummary(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={count === 0}
        className={
          triggerClassName ??
          `inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground ${
            compact ? "" : ""
          }`
        }
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {triggerLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default bg-foreground/40"
            onClick={close}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Add to campaign</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Adding {count} lead{count === 1 ? "" : "s"} to the campaign. The first step is queued immediately;
                  every send still passes the suppression gate.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {summary ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">{summary.enrolled}</span> enrolled
                    {summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""}.
                  </span>
                </div>
                {summary.skipped > 0 && summary.skippedByCode ? (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {Object.entries(summary.skippedByCode).map(([code, n]) => (
                      <li key={code} className="flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                        {n} {SKIP_LABEL[code] ?? code.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-foreground">Campaign sequence</span>
                  <select
                    value={sequenceId}
                    onChange={(e) => setSequenceId(e.target.value)}
                    disabled={noSequences}
                    className="h-9 w-full cursor-pointer rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40"
                  >
                    <option value="">{noSequences ? "No published campaign sequences" : "Select a campaign sequence"}</option>
                    {options.sequences.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.stepCount} step{s.stepCount === 1 ? "" : "s"})
                      </option>
                    ))}
                  </select>
                  {noSequences ? (
                    <span className="text-xs text-muted-foreground">
                      Publish a campaign at /v2/outreach/campaigns first.
                    </span>
                  ) : null}
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-foreground">Send from</span>
                  <select
                    value={senderId}
                    onChange={(e) => setSenderId(e.target.value)}
                    disabled={noSenders}
                    className="h-9 w-full cursor-pointer rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40"
                  >
                    <option value="">{noSenders ? "No active senders" : "Select a sender"}</option>
                    {options.senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName} - {s.fromAddress}
                        {s.liveSendEnabled ? "" : " (gated)"}
                      </option>
                    ))}
                  </select>
                  {noSenders ? (
                    <span className="text-xs text-muted-foreground">Add a sender at /v2/outreach/senders first.</span>
                  ) : null}
                </label>

                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!canSubmit}
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground"
                  >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
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
