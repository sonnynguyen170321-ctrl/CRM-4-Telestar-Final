"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyJobIdButton({ jobId }: { jobId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(jobId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? "Copied" : "Copy ID"}
    </button>
  );
}
