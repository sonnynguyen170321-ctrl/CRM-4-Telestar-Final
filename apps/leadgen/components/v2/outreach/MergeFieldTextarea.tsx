"use client";

import { useRef, useState } from "react";

import { CAMPAIGN_MERGE_VARIABLES } from "@/lib/v2/outreach/campaigns/mergeVariables";

// Drop-in replacement for a plain <textarea> that adds the merge-variable insert toolbar
// (same chips as the campaign variant editor). Uncontrolled toward the form (name +
// defaultValue) so it slots into server-action <form>s without changing submission.

export function MergeFieldTextarea({
  name,
  defaultValue,
  rows = 13,
  required,
  className,
}: {
  name: string;
  defaultValue?: string;
  rows?: number;
  required?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(key: string) {
    const token = `{{${key}}}`;
    const el = ref.current;
    if (!el) {
      setValue((v) => v + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {CAMPAIGN_MERGE_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => insert(v.key)}
            title={v.label}
            className="inline-flex min-h-7 cursor-pointer items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary"
          >
            {`{{${v.key}}}`}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        name={name}
        rows={rows}
        required={required}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={className}
      />
    </div>
  );
}
