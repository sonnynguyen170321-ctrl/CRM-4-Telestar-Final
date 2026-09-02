"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SdrActivitySummary } from "@/lib/activityRecaps/types";

type SdrActivitySummaryTableProps = {
  summaries: SdrActivitySummary[];
};

export function SdrActivitySummaryTable({
  summaries,
}: SdrActivitySummaryTableProps) {
  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        No SDR activity summary yet. Upload and map a file first.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead>SDR</TableHead>
            <TableHead className="text-center">LinkedIn</TableHead>
            <TableHead className="text-center">Email</TableHead>
            <TableHead className="text-center">Call</TableHead>
            <TableHead className="text-center">No pick up</TableHead>
            <TableHead className="text-center">Not interested</TableHead>
            <TableHead className="text-center">Other</TableHead>
            <TableHead className="text-center">Sum</TableHead>
            <TableHead className="text-center">Unique leads</TableHead>
            <TableHead className="text-center">Unique companies</TableHead>
            <TableHead className="text-center">Manager review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaries.map((summary) => (
            <TableRow key={summary.sdrName}>
              <TableCell className="font-semibold text-slate-900">
                {summary.sdrName}
              </TableCell>
              <NumericCell value={summary.linkedinCount} />
              <NumericCell value={summary.emailCount} />
              <NumericCell value={summary.callCount} />
              <NumericCell value={summary.noPickupCount} />
              <NumericCell value={summary.notInterestedCount} />
              <NumericCell value={summary.otherChannelCount} />
              <NumericCell value={summary.totalActivityCount} strong />
              <NumericCell value={summary.uniqueLeadsTouched} />
              <NumericCell value={summary.uniqueCompaniesTouched} />
              <NumericCell value={summary.managerReviewCount} strong />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NumericCell({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <TableCell
      className={`text-center ${strong ? "font-semibold text-slate-950" : "text-slate-700"}`}
    >
      {value.toLocaleString()}
    </TableCell>
  );
}

