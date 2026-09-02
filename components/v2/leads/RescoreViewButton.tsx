import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Re-score the current filtered view (project + ICP). Navigates to the
// /v2/leads/rescore-view confirmation page.

export function RescoreViewButton({
  projectId,
  icpVersionId,
  variant = "primary",
  label = "Run scoring",
}: {
  projectId?: string;
  icpVersionId?: string;
  variant?: "primary" | "outline";
  label?: string;
}) {
  const ready = Boolean(projectId && icpVersionId);
  const href = ready ? `/v2/workspace/leads/rescore-view?projectId=${projectId}&icpVersionId=${icpVersionId}` : "#";

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <Button
        asChild
        size="sm"
        variant={variant === "primary" ? "default" : "outline"}
        className={cn(
          "cursor-pointer", 
          variant === "primary" && "bg-primary hover:bg-primary",
          !ready && "opacity-50 pointer-events-none"
        )}
        title={ready ? "Re-score every assignment in this project + ICP view" : "Select Account, Project and ICP first"}
      >
        <Link href={href} aria-disabled={!ready} tabIndex={!ready ? -1 : undefined}>
          <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {label}
        </Link>
      </Button>
    </div>
  );
}
