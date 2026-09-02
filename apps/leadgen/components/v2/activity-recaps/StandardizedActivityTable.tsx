"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { formatCount } from "@/lib/v2/format/datetime";

import type { StandardizedActivityRow } from "@/lib/v2/activity-recaps/queryRecapSummary";
import { ActivityRowDrawer } from "./ActivityRowDrawer";

// "Standardized Activity" table (mock bottom section). Rows come from queryStandardizedRows
// (capped, server-side). Filters + search run client-side over the loaded page; clicking a
// row opens the Redis-backed fast drawer (no navigation).

type MatchedFilter = "all" | "matched" | "unmatched";
type FlagFilter = "all" | "flagged" | "clear";

export function StandardizedActivityTable({
  jobId,
  rows,
}: {
  jobId: string;
  rows: StandardizedActivityRow[];
}) {
  const [search, setSearch] = useState("");
  const [sdr, setSdr] = useState("all");
  const [channel, setChannel] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [matched, setMatched] = useState<MatchedFilter>("all");
  const [flag, setFlag] = useState<FlagFilter>("all");
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const sdrOptions = useMemo(() => uniqueValues(rows.map((row) => row.sdr)), [rows]);
  const channelOptions = useMemo(() => uniqueValues(rows.map((row) => row.channel)), [rows]);
  const outcomeOptions = useMemo(() => uniqueValues(rows.map((row) => row.outcome)), [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (sdr !== "all" && row.sdr !== sdr) return false;
      if (channel !== "all" && row.channel !== channel) return false;
      if (outcome !== "all" && row.outcome !== outcome) return false;
      if (matched === "matched" && !row.matchedCompanyId) return false;
      if (matched === "unmatched" && row.matchedCompanyId) return false;
      if (flag === "flagged" && !row.managerReviewFlag) return false;
      if (flag === "clear" && row.managerReviewFlag) return false;
      if (needle) {
        const haystack = [row.sdr, row.company, row.contact, row.note, row.outcome]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, search, sdr, channel, outcome, matched, flag]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Standardized Activity ({formatCount(rows.length)} rows)
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">All mapped activity ready for review</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search activities…"
              className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilterSelect label="SDR" value={sdr} onChange={setSdr} options={sdrOptions} />
          <FilterSelect label="Channel" value={channel} onChange={setChannel} options={channelOptions} />
          <FilterSelect label="Outcome" value={outcome} onChange={setOutcome} options={outcomeOptions} />
          <FilterSelect
            label="Matched"
            value={matched}
            onChange={(value) => setMatched(value as MatchedFilter)}
            options={["matched", "unmatched"]}
          />
          <FilterSelect
            label="Review Flag"
            value={flag}
            onChange={(value) => setFlag(value as FlagFilter)}
            options={["flagged", "clear"]}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-normal text-muted-foreground">
            <tr>
              <th className="px-4 py-3">SDR</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Activity Date</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Flag</th>
              <th className="px-4 py-3">Matched</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((row) => (
              <tr
                key={row.id}
                onClick={() => setOpenRowId(row.id)}
                className="cursor-pointer transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3 font-medium text-foreground">{row.sdr ?? "—"}</td>
                <td className="px-4 py-3 text-foreground">{row.company ?? "—"}</td>
                <td className="px-4 py-3 text-foreground">{row.contact ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.channel ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{row.activityDate ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.outcome ?? "—"}</td>
                <td className="px-4 py-3">
                  {row.managerReviewFlag ? (
                    <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Yes
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.matchedCompanyId ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <XCircle className="h-3.5 w-3.5" /> Unmatched
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No activity rows match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {openRowId ? (
        <ActivityRowDrawer
          key={openRowId}
          jobId={jobId}
          rowId={openRowId}
          onClose={() => setOpenRowId(null)}
        />
      ) : null}
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-lg border border-border bg-white px-2 text-xs text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20"
      >
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function uniqueValues(values: Array<string | null>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value && value.trim())))
  ).sort((left, right) => left.localeCompare(right));
}
