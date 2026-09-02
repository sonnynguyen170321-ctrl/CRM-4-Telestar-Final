"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type WorkflowStatusFormProps = {
  leadAssignmentId: string;
  currentStatus: string;
  statuses: readonly string[];
};

type WorkflowResponse =
  | {
      ok: true;
      code: "WORKFLOW_STATUS_UPDATED";
      workflowStatus: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      currentStatus?: string;
    };

export function WorkflowStatusForm({
  leadAssignmentId,
  currentStatus,
  statuses,
}: WorkflowStatusFormProps) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(currentStatus);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      const response = await fetch(`/v2/workspace/leads/${leadAssignmentId}/workflow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previousStatus: currentStatus,
          nextStatus,
          note,
        }),
      });
      const result = (await response.json()) as WorkflowResponse;

      if (result.ok) {
        setNote("");
        router.refresh();
        return;
      }

      if (response.status === 409 && result.currentStatus) {
        setMessage(
          `${result.message} Current status is ${formatWorkflowStatus(result.currentStatus)}. Refresh and try again.`
        );
      } else if (response.status === 403) {
        setMessage("You do not have permission to update this workflow.");
      } else {
        setMessage(result.message || "Workflow update failed.");
      }
    } catch {
      setMessage("Workflow update failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-border bg-muted/40 p-3"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="previousStatus" value={currentStatus} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="block text-xs font-medium text-muted-foreground">
          Workflow status
          <select
            className="mt-1 h-9 w-full rounded-lg border border-input bg-white px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            name="nextStatus"
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {formatWorkflowStatus(status)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Updating..." : "Update workflow"}
          </Button>
        </div>
      </div>
      <label className="mt-3 block text-xs font-medium text-muted-foreground">
        Note optional
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-input bg-white px-2 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          maxLength={500}
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Short audit note"
        />
      </label>
      {message && <p className="mt-2 text-sm text-rose-600">{message}</p>}
    </form>
  );
}

function formatWorkflowStatus(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}
