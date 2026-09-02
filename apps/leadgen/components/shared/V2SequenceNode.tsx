import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type V2SequenceNodeKind = "email" | "wait" | "branch" | "stop" | "task";

type V2SequenceNodeProps = {
  kind: V2SequenceNodeKind;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  className?: string;
};

const kindClassName: Record<V2SequenceNodeKind, string> = {
  email: "border-primary/30 bg-[#EFF4FF]",
  wait: "border-[#14B8A6]/30 bg-teal-50",
  branch: "border-[#7C3AED]/30 bg-purple-50",
  stop: "border-slate-300 bg-slate-50",
  task: "border-[#F59E0B]/30 bg-amber-50",
};

export function V2SequenceNode({
  kind,
  title,
  description,
  meta,
  selected = false,
  className,
}: V2SequenceNodeProps) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 shadow-xs transition-colors duration-200",
        kindClassName[kind],
        selected && "ring-2 ring-primary/20",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">{kind}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{title}</div>
        </div>
        {meta ? <div className="shrink-0 text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {description ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div> : null}
    </div>
  );
}
