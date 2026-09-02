"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { V2DetailDrawer, EntityHeader } from "@/components/v2/drawers/V2DetailDrawer";
import { RowInspectorContent } from "@/components/v2/drawers/RowInspectorContent";

type InspectorRow = {
  id: string;
  sourceRowNumber: number;
  rowStatus: string;
  rawRowJson: unknown;
  normalizedRowJson: unknown;
  matchedCompanyId: string | null;
  matchedContactId: string | null;
  matchedCompanyName: string | null;
  matchedContactName: string | null;
  errorMessage: string | null;
};

export function ActivityRowDrawer({
  jobId,
  rowId,
  onClose,
}: {
  jobId: string;
  rowId: string;
  onClose: () => void;
}) {
  const [row, setRow] = useState<InspectorRow | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "idle">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/v2/activity-recaps/${jobId}/rows/${rowId}`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok && body.row) {
          setRow(body.row as InspectorRow);
          setStatus("idle");
        } else {
          setStatus("error");
        }
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [jobId, rowId]);

  return (
    <V2DetailDrawer open={true} onClose={onClose} widthClass="lg:w-[640px]">
      <EntityHeader
        eyebrow="Row inspector"
        title={row ? `Row ${row.sourceRowNumber}` : "Loading\u2026"}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading row\u2026
          </div>
        ) : status === "error" ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600 shadow-premium">
            The row could not be loaded.
          </div>
        ) : row ? (
          <RowInspectorContent row={row} />
        ) : null}
      </div>
    </V2DetailDrawer>
  );
}
