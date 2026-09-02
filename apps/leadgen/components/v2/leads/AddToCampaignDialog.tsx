"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, X } from "lucide-react";

import { campaignWithSelectionHref } from "@/lib/v2/crm/leadRoutes";

// W3: "Add to campaign" for a selection of leads. Campaigns use sequence steps behind the scenes; this picks
// an existing campaign and navigates to its review stage scoped to the selection
// (?source=selected&leadIds=...) - so the launch picker shows exactly the chosen leads,
// not a global top-200. Navigation only; the actual enrol happens in the campaign's
// gated launch.

export type CampaignOption = { id: string; name: string; status: string };

export function AddToCampaignDialog({
  leadAssignmentIds,
  campaigns,
  onPicked,
}: {
  leadAssignmentIds: string[];
  campaigns: CampaignOption[];
  onPicked?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const count = leadAssignmentIds.length;

  function pick(campaignId: string) {
    onPicked?.();
    router.push(campaignWithSelectionHref(campaignId, leadAssignmentIds));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={count === 0}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground outline-none transition-colors duration-200 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Megaphone className="h-4 w-4" aria-hidden="true" />
        Add to campaign
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-foreground/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Add to campaign</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Open a campaign with these {count} lead{count === 1 ? "" : "s"} as its source, then review + launch.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="cursor-pointer rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="Close dialog">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4">
              {campaigns.length === 0 ? (
                <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  No campaigns yet. Create one at{" "}
                  <Link href="/v2/outreach/campaigns/new" className="font-medium text-primary hover:text-primary">/v2/outreach/campaigns/new</Link>.
                </p>
              ) : (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {campaigns.map((campaign) => (
                    <li key={campaign.id}>
                      <button
                        type="button"
                        onClick={() => pick(campaign.id)}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{campaign.name}</span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{campaign.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
