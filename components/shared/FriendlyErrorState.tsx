import type { ReactNode } from "react";
import { AlertTriangle, KeyRound, Lock, MailWarning, Radar, RotateCcw, ShieldAlert, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FriendlyErrorReason =
  | "missing_provider_key"
  | "no_worker_online"
  | "rate_limited"
  | "no_website"
  | "waf_blocked"
  | "no_people_found"
  | "email_verification_unavailable"
  | "permission_denied"
  | "tenant_mismatch"
  | "generic";

type FriendlyErrorStateProps = {
  reason?: FriendlyErrorReason;
  title?: string;
  message?: string;
  action?: ReactNode;
  onRetry?: () => void;
  className?: string;
};

const FRIENDLY_ERROR_COPY: Record<FriendlyErrorReason, { title: string; message: string; icon: typeof AlertTriangle }> = {
  missing_provider_key: {
    title: "Provider key is missing",
    message: "Add the provider key in Settings before running live discovery or enrichment. Existing reviewed data is still safe.",
    icon: KeyRound,
  },
  no_worker_online: {
    title: "No worker is online",
    message: "The request is queued, but no background worker is currently draining jobs. Start the worker or use the page run control when available.",
    icon: AlertTriangle,
  },
  rate_limited: {
    title: "Provider rate limit reached",
    message: "The provider slowed this workflow down. Retry after the window resets or reduce the batch size.",
    icon: WifiOff,
  },
  no_website: {
    title: "No website found",
    message: "This record can still be reviewed, but company enrichment needs a domain or website before it can pull deeper context.",
    icon: Radar,
  },
  waf_blocked: {
    title: "Website blocked automated research",
    message: "The company website appears protected by WAF or bot controls. Keep public evidence, then retry with another source if needed.",
    icon: ShieldAlert,
  },
  no_people_found: {
    title: "No people found yet",
    message: "The company can stay in review, but people discovery did not find a usable contact from the available public sources.",
    icon: Radar,
  },
  email_verification_unavailable: {
    title: "Email verification is unavailable",
    message: "The contact can still be added to leads. Configure Reacher or another verifier to raise confidence later.",
    icon: MailWarning,
  },
  permission_denied: {
    title: "Permission needed",
    message: "Your role cannot access this workspace or action. Ask an admin to update your V2 permissions.",
    icon: Lock,
  },
  tenant_mismatch: {
    title: "Workspace mismatch",
    message: "This record belongs to another organization or inactive workspace, so TeleStar blocked the request for tenant safety.",
    icon: ShieldAlert,
  },
  generic: {
    title: "Something blocked this workflow",
    message: "Retry the action. If it keeps happening, capture the workspace and ask the project owner to inspect the runtime log.",
    icon: AlertTriangle,
  },
};

export function FriendlyErrorState({ reason = "generic", title, message, action, onRetry, className }: FriendlyErrorStateProps) {
  const copy = FRIENDLY_ERROR_COPY[reason] ?? FRIENDLY_ERROR_COPY.generic;
  const Icon = copy.icon;

  return (
    <div className={cn("flex min-h-56 flex-col items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-6 py-10 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-amber-700 shadow-sm ring-1 ring-amber-100">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-slate-950">{title ?? copy.title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{message ?? copy.message}</p>
      {action || onRetry ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button type="button" size="sm" onClick={onRetry}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Retry
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}