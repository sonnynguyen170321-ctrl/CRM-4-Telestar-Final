"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type ReviewResolutionPanelProps = {
  reviewItemId: string;
};

type ResolveResponse =
  | {
      ok: true;
      code: "REVIEW_ITEM_RESOLVED" | "REVIEW_ITEM_ALREADY_RESOLVED";
      status: string;
      resolutionType: string | null;
      noop?: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

// Canonical resolution types live in lib/v2/manager-review/types.ts (server-only).
// The route validates against that source of truth; this list is display-only.
const RESOLUTION_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  {
    value: "APPROVE_CONFIRM",
    label: "Approve / confirm match",
    hint: "Accept the suggested match or assessment as correct.",
  },
  {
    value: "LINK_EXISTING",
    label: "Link existing entity",
    hint: "Attach to an already-existing company / contact / lead.",
  },
  {
    value: "CREATE_MISSING_ENTITY_LATER",
    label: "Create missing entity (later)",
    hint: "No existing match; flag to create the entity downstream.",
  },
  {
    value: "REQUEST_CHANGES",
    label: "Request changes / info",
    hint: "Send back for more information before resolving.",
  },
  {
    value: "UPDATE_WORKFLOW_STATUS_LATER",
    label: "Update workflow status (later)",
    hint: "Resolution implies a workflow-status change on the lead.",
  },
  {
    value: "CONVERT_TO_FEEDBACK_LATER",
    label: "Convert to feedback (later)",
    hint: "Capture as a scoring-feedback example (M3).",
  },
  {
    value: "NO_ACTION_NON_ACTIONABLE",
    label: "No action / non-actionable",
    hint: "Close without a downstream change.",
  },
  {
    value: "REJECT_DISMISS",
    label: "Reject / dismiss",
    hint: "Reject the suggestion and dismiss the item.",
  },
];

export function ReviewResolutionPanel({
  reviewItemId,
}: ReviewResolutionPanelProps) {
  const router = useRouter();
  const [resolutionType, setResolutionType] = useState(
    RESOLUTION_OPTIONS[0].value
  );
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeHint =
    RESOLUTION_OPTIONS.find((option) => option.value === resolutionType)?.hint ??
    "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/v2/reviews/${reviewItemId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionType, resolutionNote: note }),
      });
      const result = (await response.json()) as ResolveResponse;

      if (result.ok) {
        setNote("");
        // Resolved item leaves the active queue; refresh to drop it.
        router.refresh();
        return;
      }

      if (response.status === 403) {
        setError("You do not have permission to resolve review items.");
      } else if (response.status === 409) {
        setError(
          `${result.message} Refresh the queue and try again.`
        );
      } else {
        setError(result.message || "Review resolution failed.");
      }
    } catch {
      setError("Review resolution failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-muted/40 p-3"
      onSubmit={handleSubmit}
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">Resolve item</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Resolving moves the item out of the active queue and writes an audit
          event. Old assessments are never mutated.
        </p>
      </div>
      <label className="block text-xs font-medium text-muted-foreground">
        Resolution
        <select
          className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={resolutionType}
          onChange={(event) => setResolutionType(event.target.value)}
        >
          {RESOLUTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {activeHint && <p className="text-xs text-muted-foreground">{activeHint}</p>}
      <label className="block text-xs font-medium text-muted-foreground">
        Resolution note (optional)
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-input bg-white px-2 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this resolution? (audit trail)"
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Resolving..." : "Resolve item"}
        </Button>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </form>
  );
}
