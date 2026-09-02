import { CircleAlert, CircleCheck, CirclePause, FilePenLine } from "lucide-react";

import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  DRAFT: "border-primary/20 bg-accent text-primary",
  PAUSED: "border-amber-200 bg-amber-50 text-amber-800",
  ARCHIVED: "border-border bg-muted text-muted-foreground",
};

export function CampaignStatusBadge({ status }: { status: string }) {
  const Icon =
    status === "ACTIVE"
      ? CircleCheck
      : status === "PAUSED"
        ? CirclePause
        : status === "DRAFT"
          ? FilePenLine
          : CircleAlert;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        STATUS_STYLE[status] ?? STATUS_STYLE.ARCHIVED
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {formatCampaignLabel(status)}
    </span>
  );
}

export function formatCampaignLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}