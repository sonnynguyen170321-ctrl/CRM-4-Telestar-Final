"use client";

import { MoreHorizontal, SkipForward, Trash2, Activity } from "lucide-react";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import { skipCampaignEmailAction, deleteCampaignEmailAction } from "@/app/v2/outreach/campaigns/[campaignId]/emailActions";

export function CampaignEmailRowMenu({ emailId, campaignId }: { emailId: string; campaignId: string }) {
  const [isPending, startTransition] = useTransition();


  function onSkip() {
    startTransition(async () => {
      await skipCampaignEmailAction(campaignId, emailId);
      toast.success("Email skipped. Sequence will continue.");
    });
  }

  function onDelete() {
    startTransition(async () => {
      await deleteCampaignEmailAction(campaignId, emailId);
      toast.success("Email deleted. Sequence finished for this contact.");
    });
  }

  function onDiagnostics() {
    toast.info("Diagnostics information would appear here.");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button disabled={isPending} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent hover:border-border hover:bg-muted/40 data-[state=open]:border-border data-[state=open]:bg-muted/40 transition-colors">
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onSkip} disabled={isPending} className="gap-2 cursor-pointer">
          <SkipForward className="h-4 w-4 text-amber-600" /> Skip email
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} disabled={isPending} className="gap-2 cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50">
          <Trash2 className="h-4 w-4" /> Delete email
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDiagnostics} disabled={isPending} className="gap-2 cursor-pointer">
          <Activity className="h-4 w-4 text-muted-foreground" /> Show Diagnostics Information
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
