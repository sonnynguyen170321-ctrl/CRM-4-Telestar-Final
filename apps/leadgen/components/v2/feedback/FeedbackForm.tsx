"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type FeedbackFormProps = {
  leadAssignmentId?: string;
};

type FeedbackResponse =
  | { ok: true; code: string; feedbackId: string; noop?: boolean }
  | { ok: false; code: string; message: string };

// Display-only lists; the route validates against the canonical server set.
const FINAL_QUALIFICATIONS: Array<{ value: string; label: string }> = [
  { value: "QUALIFIED", label: "Qualified" },
  { value: "COMPANY_QUALIFIED_NEEDS_CONTACT", label: "Needs a decision-maker" },
  { value: "NEEDS_REVIEW", label: "Needs review" },
  { value: "UNQUALIFIED", label: "Unqualified" },
];

const DATASET_SPLITS = ["UNSPECIFIED", "TRAIN", "EVAL", "HOLDOUT"];

export function FeedbackForm({ leadAssignmentId = "" }: FeedbackFormProps) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(leadAssignmentId);
  const [finalQualification, setFinalQualification] = useState(
    FINAL_QUALIFICATIONS[0].value
  );
  const [finalFitScore, setFinalFitScore] = useState("");
  const [finalReason, setFinalReason] = useState("");
  const [approvedForLearning, setApprovedForLearning] = useState(false);
  const [datasetSplit, setDatasetSplit] = useState("UNSPECIFIED");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      const response = await fetch(`/v2/feedback/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadAssignmentId: leadId.trim(),
          finalQualification,
          finalFitScore: finalFitScore === "" ? null : Number(finalFitScore),
          finalReason,
          approvedForLearning,
          datasetSplit,
        }),
      });
      const result = (await response.json()) as FeedbackResponse;

      if (result.ok) {
        setMessage({
          tone: "ok",
          text: result.noop
            ? "Identical feedback already captured (no duplicate created)."
            : "Feedback captured.",
        });
        setFinalReason("");
        setFinalFitScore("");
        router.refresh();
        return;
      }

      if (response.status === 403) {
        setMessage({ tone: "error", text: "You do not have permission to capture feedback." });
      } else {
        setMessage({ tone: "error", text: result.message || "Feedback capture failed." });
      }
    } catch {
      setMessage({ tone: "error", text: "Feedback capture failed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-white p-4"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground">Capture feedback</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Records the human-corrected truth against the current immutable
          assessment. Never changes the assessment or the ICP rules.
        </p>
      </div>

      <label className="block text-xs font-medium text-muted-foreground">
        Lead assignment ID
        <input
          className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={leadId}
          onChange={(event) => setLeadId(event.target.value)}
          placeholder="la_..."
          readOnly={Boolean(leadAssignmentId)}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-muted-foreground">
          Final qualification
          <select
            className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={finalQualification}
            onChange={(event) => setFinalQualification(event.target.value)}
          >
            {FINAL_QUALIFICATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Final fit score (0-100, optional)
          <input
            type="number"
            min={0}
            max={100}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={finalFitScore}
            onChange={(event) => setFinalFitScore(event.target.value)}
            placeholder="—"
          />
        </label>
      </div>

      <label className="block text-xs font-medium text-muted-foreground">
        Reason / correction note (optional)
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-input bg-white px-2 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          maxLength={2000}
          value={finalReason}
          onChange={(event) => setFinalReason(event.target.value)}
          placeholder="Why is the corrected qualification right?"
        />
      </label>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={approvedForLearning}
            onChange={(event) => setApprovedForLearning(event.target.checked)}
          />
          Approve for learning
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Dataset split
          <select
            className="h-8 rounded-lg border border-input bg-white px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={datasetSplit}
            onChange={(event) => setDatasetSplit(event.target.value)}
          >
            {DATASET_SPLITS.map((split) => (
              <option key={split} value={split}>
                {split}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button type="submit" disabled={pending || !leadId.trim()}>
          {pending ? "Saving..." : "Capture feedback"}
        </Button>
        {message && (
          <p
            className={`text-sm ${
              message.tone === "ok" ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
