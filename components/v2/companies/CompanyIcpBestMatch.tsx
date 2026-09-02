import Link from "next/link";
import { Trophy, AlertTriangle } from "lucide-react";

import type { IcpBestMatchResult, RankedIcpMatch } from "@/lib/v2/crm";

// S1 SEE-IT: best-fit ICP presenter for a company. Honest by construction — it only
// claims a "best fit" when the top assignment is a decided positive qualification
// (result.confident); otherwise it frames the top row as a candidate that still
// needs review. There is no global company qualification (Invariant 2/3).

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ");
}

export function CompanyIcpBestMatch({ result }: { result: IcpBestMatchResult }) {
  const best = result.best;
  if (!best) return null;
  const others = result.ranked.slice(1);

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Best-fit ICP</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranked across {result.totalIcps} ICP{result.totalIcps === 1 ? "" : "s"} this company is assigned to.
          </p>
        </div>
      </div>

      <div
        className={`mt-3 rounded-lg border p-4 ${
          result.confident ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex items-start gap-3">
          {result.confident ? (
            <Trophy className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              {best.icpProfileName} v{best.icpVersionNumber}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{best.projectName}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-foreground">
                {formatLabel(best.qualification)}
              </span>
              <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-foreground">
                Fit {best.fitScore ?? "—"}
              </span>
              <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-foreground">
                {formatLabel(best.workflowStatus)}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {result.confident
                ? "Strongest confirmed fit among this company's ICPs."
                : "Top candidate, but not a confident fit yet — score or review before acting."}
            </p>
            <Link
              href={`/v2/workspace/leads?selectedLeadId=${best.leadAssignmentId}`}
              className="mt-2 inline-flex text-xs font-medium text-primary hover:text-primary"
            >
              Open this assignment
            </Link>
          </div>
        </div>
      </div>

      {others.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-medium text-muted-foreground">Why the other ICPs rank lower</div>
          <ul className="mt-2 space-y-1.5">
            {others.map((row: RankedIcpMatch) => (
              <li key={row.leadAssignmentId} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-foreground">
                  #{row.rank} {row.icpProfileName} v{row.icpVersionNumber}
                  <span className="ml-1.5 text-muted-foreground">{formatLabel(row.qualification)}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{row.gapReason ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
