"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, RefreshCw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AddToCampaignDialog, type CampaignOption } from "@/components/v2/leads/AddToCampaignDialog";
import { composeHref } from "@/lib/v2/crm/leadRoutes";
import type { LeadEnrollment } from "@/lib/v2/outreach/sequences/queryEnrollment";

const STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PAUSED: "bg-amber-50 text-amber-700",
  HALTED: "bg-red-50 text-red-700",
  COMPLETED: "bg-muted text-muted-foreground",
};

export function LeadDrawerActions({
  leadAssignmentId,
  enrollments = [],
  campaigns = [],
  outreachReady = true,
  outreachDisabledReason = "Needs a verified, non-generic email before email outreach.",
}: {
  leadAssignmentId: string;
  enrollments?: LeadEnrollment[];
  campaigns?: CampaignOption[];
  outreachReady?: boolean;
  outreachDisabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function rescore() {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/v2/workspace/leads/${leadAssignmentId}/rescore`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          setMessage({ tone: "error", text: body.message ?? "Re-score failed." });
          return;
        }
        const counts = body.counts as
          | { scored?: number; created?: number; reused?: number; failed?: number }
          | undefined;
        setMessage({
          tone: "ok",
          text: counts && (counts.scored ?? 0) > 0
            ? `Re-scored ${counts.scored} lead (${counts.created ?? 0} new, ${counts.reused ?? 0} reused, ${counts.failed ?? 0} failed).`
            : "Re-score drained; no changed assessment.",
        });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: "Re-score request failed." });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="outline" className="cursor-pointer" disabled={pending} onClick={rescore}>
          {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Re-score
        </Button>
        <span title={outreachReady ? "Add this lead to a campaign" : outreachDisabledReason}>
          <AddToCampaignDialog leadAssignmentIds={outreachReady ? [leadAssignmentId] : []} campaigns={campaigns} onPicked={() => router.refresh()} />
        </span>
        {outreachReady ? (
          <Button size="sm" variant="outline" className="cursor-pointer" asChild title="Compose a gated one-off outreach email (suppression-checked)">
            <Link href={composeHref(leadAssignmentId)}>
              <Send className="mr-1.5 h-4 w-4" />
              One-off email
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="cursor-not-allowed opacity-60" disabled title={outreachDisabledReason}>
            <Send className="mr-1.5 h-4 w-4" />
            Email blocked
          </Button>
        )}
      </div>

      {!outreachReady ? (
        <span className="max-w-[320px] text-right text-xs font-medium text-amber-700">{outreachDisabledReason}</span>
      ) : null}

      {enrollments.length > 0 ? (
        <div className="flex w-full flex-col items-stretch gap-1.5">
          {enrollments.map((enrollment) => (
            <div key={enrollment.enrollmentId} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{enrollment.sequenceName}</span>
                <span className="ml-1.5 text-muted-foreground">step {enrollment.currentStepOrdinal}</span>
                {enrollment.haltReason ? <span className="ml-1.5 text-red-600">- {enrollment.haltReason}</span> : null}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${STATUS_CLS[enrollment.status] ?? "bg-muted text-muted-foreground"}`}>{enrollment.status}</span>
            </div>
          ))}
        </div>
      ) : null}

      {message && <span className={`text-xs ${message.tone === "ok" ? "text-emerald-600" : "text-destructive"}`}>{message.text}</span>}
    </div>
  );
}
