import type { ReactNode } from "react";

// Evidence row for why-drawer / data-log: a labelled fact with an optional source
// link and tone. Source links are clickable (cursor-pointer via anchor). No emoji.

type Tone = "neutral" | "positive" | "negative" | "warning";

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-slate-300",
  positive: "bg-[#16A34A]",
  negative: "bg-[#EF4444]",
  warning: "bg-[#F59E0B]",
};

export function EvidenceCard({
  label,
  value,
  detail,
  tone = "neutral",
  sourceLabel,
  sourceHref,
}: {
  label: string;
  value?: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  sourceLabel?: string;
  sourceHref?: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-[#0F172A]">{label}</span>
          {value !== undefined && <span className="text-sm tabular-nums text-slate-700">{value}</span>}
        </div>
        {detail && <p className="mt-0.5 text-xs text-slate-500">{detail}</p>}
        {sourceHref && (
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block cursor-pointer text-xs font-medium text-[#0F5BF4] underline-offset-2 hover:underline"
          >
            {sourceLabel ?? "Source"}
          </a>
        )}
      </div>
    </div>
  );
}
