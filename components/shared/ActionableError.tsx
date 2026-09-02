import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

// Guided error block. Replaces raw "Code: {technicalCode}" / bare "FAILED" surfaces with a clear
// reason + a fix CTA ("Missing provider key → Add key"). Token-driven so it themes in light + dark.
// The technical code is kept only as a small muted footnote for support, never the headline.

export function ActionableError({
  title,
  reason,
  actionLabel,
  actionHref,
  onAction,
  technicalCode,
  icon,
  className,
}: {
  title: string;
  reason?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  technicalCode?: string | null;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-xl rounded-xl border border-border bg-card p-6 text-center shadow-sm ${className ?? ""}`}>
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        {icon ?? <AlertTriangle className="h-5 w-5" aria-hidden="true" />}
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {reason ? <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{reason}</p> : null}
      {actionLabel && (actionHref || onAction) ? (
        actionHref ? (
          <a href={actionHref} className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90">
            {actionLabel}
          </a>
        ) : (
          <button type="button" onClick={onAction} className="mt-5 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90">
            {actionLabel}
          </button>
        )
      ) : null}
      {technicalCode ? <p className="mt-4 text-[11px] text-muted-foreground/60">Ref: {technicalCode}</p> : null}
    </div>
  );
}
