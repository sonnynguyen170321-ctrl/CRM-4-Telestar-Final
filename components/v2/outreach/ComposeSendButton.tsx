"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Send } from "lucide-react";

export function ComposeSendButton({
  canSend,
  mode,
  blockers = [],
}: {
  canSend: boolean;
  mode: "live" | "sandbox";
  blockers?: string[];
}) {
  const { pending } = useFormStatus();
  const disabled = !canSend || pending;
  const live = mode === "live";
  const blockedTitle = blockers.length > 0 ? `Blocked: ${blockers.join("; ")}` : "Resolve the readiness checklist first";

  return (
    <button
      type="submit"
      disabled={disabled}
      title={canSend ? (live ? "Enqueue the send - Live SMTP, gate-checked" : "Enqueue the send - sandbox, gate-checked") : blockedTitle}
      className={
        "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md px-4 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-foreground " +
        (live ? "bg-emerald-600 hover:bg-emerald-700" : "bg-primary hover:bg-primary")
      }
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending...
        </>
      ) : (
        <>
          <Send className="h-4 w-4" aria-hidden="true" /> {live ? "Send live" : "Send sandbox"}
        </>
      )}
    </button>
  );
}
