"use client";

import { PriorityBadge } from "@/components/activity-recaps/StandardizedActivityTable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StandardizedSdrActivityRow } from "@/lib/activityRecaps/types";

type ManagerReviewPreviewTableProps = {
  rows: StandardizedSdrActivityRow[];
};

export function ManagerReviewPreviewTable({
  rows,
}: ManagerReviewPreviewTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        No manager review rows match the current file and rules.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead>Priority</TableHead>
            <TableHead>SDR</TableHead>
            <TableHead>Lead</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Channel / stage</TableHead>
            <TableHead>Note</TableHead>
            <TableHead>Reasons</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 120).map((row) => (
            <TableRow key={`review-${row.rowIndex}`}>
              <TableCell>
                <PriorityBadge priority={row.managerReviewPriority} />
              </TableCell>
              <TableCell className="font-medium text-slate-900">{row.sdrName}</TableCell>
              <TableCell>{row.leadName || "Missing lead"}</TableCell>
              <TableCell>{row.companyName || "Missing company"}</TableCell>
              <TableCell>
                <div className="space-y-1 text-xs text-slate-600">
                  <div>LI: {row.linkedinStageNormalized}</div>
                  <div>Email: {row.emailStageNormalized}</div>
                  <div>Call: {row.callStageNormalized}</div>
                </div>
              </TableCell>
              <TableCell>
                <div className="line-clamp-3 max-w-72 text-xs leading-5 text-slate-600">
                  {row.noteCombined || "-"}
                </div>
              </TableCell>
              <TableCell>
                <ul className="max-w-96 space-y-1 text-xs leading-5 text-slate-600">
                  {row.managerReviewReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 120 ? (
        <div className="border-t bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Showing first 120 review rows of {rows.length.toLocaleString()} flagged rows.
        </div>
      ) : null}
    </div>
  );
}

