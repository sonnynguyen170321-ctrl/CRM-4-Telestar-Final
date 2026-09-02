"use client";

import { X } from "lucide-react";

import { AddToCampaignDialog, type CampaignOption } from "@/components/v2/leads/AddToCampaignDialog";
import { ScoreAgainstIcpDialog, type ScoreIcpOption } from "@/components/v2/leads/ScoreAgainstIcpDialog";
import { useLeadSelection } from "@/components/v2/leads/LeadSelection";
import { BulkActionBarShell } from "@/components/v2/shared/BulkActionBarShell";

// Sticky bottom bar that appears once any lead is selected. Selection flows are
// campaign-scoped: score the selected leads into another ICP, then add them to a
// campaign review. Direct sequence enrollment belongs inside campaign launch.

export function LeadBulkActionBar({
  icpVersions = [],
  campaigns = [],
}: {
  icpVersions?: ScoreIcpOption[];
  campaigns?: CampaignOption[];
}) {
  const { selected, count, clear } = useLeadSelection();

  if (count === 0) return null;

  const ids = Array.from(selected);

  return (
    <BulkActionBarShell>
      <span className="text-sm font-medium text-foreground">
        <span className="tabular-nums font-semibold text-foreground">{count}</span> selected
      </span>
      <div className="h-5 w-px bg-muted" aria-hidden="true" />
      <ScoreAgainstIcpDialog leadAssignmentIds={ids} icpVersions={icpVersions} onDone={clear} />
      <AddToCampaignDialog leadAssignmentIds={ids} campaigns={campaigns} onPicked={clear} />
      <button
        type="button"
        onClick={clear}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-200 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        Clear
      </button>
    </BulkActionBarShell>
  );
}
