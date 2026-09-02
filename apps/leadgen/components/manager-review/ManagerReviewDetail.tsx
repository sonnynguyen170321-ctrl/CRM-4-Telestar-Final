"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  PriorityBadge,
  StatusBadge,
} from "@/components/manager-review/ManagerReviewWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getManagerReviewItem,
  updateManagerReviewItem,
  type ManagerReviewItem,
  type ManagerReviewStatus,
} from "@/lib/client/managerReview";

export function ManagerReviewDetail({ id }: { id: string }) {
  const [item, setItem] = useState<ManagerReviewItem | null>(null);
  const [status, setStatus] = useState<ManagerReviewStatus>("open");
  const [managerNote, setManagerNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadItem = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await getManagerReviewItem(id);
      setItem(result);
      setStatus(result.status);
      setManagerNote(result.managerNote ?? "");
      setNextAction(result.nextAction ?? "");
      setReviewedBy(result.reviewedBy ?? "");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Manager review item could not be loaded."
      );
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadItem();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadItem]);

  async function handleSave() {
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await updateManagerReviewItem(id, {
        status,
        managerNote,
        nextAction,
        reviewedBy,
      });
      setItem(result);
      setSuccessMessage("Manager review saved.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Manager review save failed."
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="px-5 py-5">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
          Loading manager review item...
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="px-5 py-5">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-sm text-rose-700">
          {errorMessage ?? "Manager review item not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-5">
        {errorMessage ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge priority={item.priority} />
              <StatusBadge status={item.status} />
            </div>
            <CardTitle>{item.leadName || item.contact?.fullName || "Review item"}</CardTitle>
            <CardDescription>
              SDR: {item.sdrName || "-"} · Company:{" "}
              {item.company?.companyName || item.companyName || "-"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Info label="Contact" value={item.contact?.fullName || item.leadName} />
            <Info label="Company" value={item.company?.companyName || item.companyName} />
            <Info label="Activity date" value={item.activityRow?.activityDate || item.activityRow?.weekLabel} />
            <Info label="Source upload" value={item.activityRow?.activityUpload.fileName} />
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Reasons and source activity</CardTitle>
            <CardDescription>
              Rule-based manager review context from the SDR activity row.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {item.reasons.length > 0 ? (
                item.reasons.map((reason) => (
                  <Badge
                    key={reason}
                    variant="outline"
                    className="border-amber-200 bg-amber-50 text-amber-700"
                  >
                    {reason}
                  </Badge>
                ))
              ) : (
                <Badge variant="outline">No stored reason</Badge>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {item.sourceNote || "No source note."}
            </div>
            {item.activityRow ? (
              <div className="grid gap-3 text-sm md:grid-cols-4">
                <Info label="LinkedIn" value={item.activityRow.linkedinStageNormalized} />
                <Info label="Email" value={item.activityRow.emailStageNormalized} />
                <Info label="Call" value={item.activityRow.callStageNormalized} />
                <Info label="Other" value={item.activityRow.otherChannelNormalized} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Linked records</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {item.contactRecordId ? (
              <Button asChild variant="outline">
                <Link href={`/contacts/${item.contactRecordId}`}>Open contact</Link>
              </Button>
            ) : null}
            {item.company?.companyName ? (
              <Button asChild variant="outline">
                <Link
                  href={`/companies?search=${encodeURIComponent(
                    item.company.companyName
                  )}`}
                >
                  Open company
                </Link>
              </Button>
            ) : null}
            {item.activityUploadId ? (
              <Button asChild variant="outline">
                <Link href="/activity-recaps">Open activity recaps</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit border-blue-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-blue-700">Manager controls</CardTitle>
          <CardDescription>
            This updates the review workflow only. It does not mutate SDR
            feedback, scoring, AI, exports, or the source activity row flag.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Status</span>
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value as ManagerReviewStatus)}
            >
              <option value="open">Open</option>
              <option value="reviewed">Reviewed</option>
              <option value="needs_follow_up">Needs follow-up</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Reviewed by</span>
            <Input
              className="mt-1"
              value={reviewedBy}
              onChange={(event) => setReviewedBy(event.target.value)}
              placeholder="Manager name"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Manager note</span>
            <textarea
              className="mt-1 min-h-28 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={managerNote}
              onChange={(event) => setManagerNote(event.target.value)}
              placeholder="Add manager review note..."
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Next action</span>
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="What should happen next?"
            />
          </label>
          <Button
            type="button"
            className="w-full bg-blue-600 text-white hover:bg-blue-700"
            disabled={isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? "Saving..." : "Save review"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{value || "-"}</div>
    </div>
  );
}
