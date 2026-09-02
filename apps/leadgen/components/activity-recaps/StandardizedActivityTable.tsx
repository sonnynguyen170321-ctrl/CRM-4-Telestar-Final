"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StandardizedSdrActivityRow } from "@/lib/activityRecaps/types";

type StandardizedActivityTableProps = {
  rows: StandardizedSdrActivityRow[];
  showCompanyMatching?: boolean;
  isSavedRecap?: boolean;
  showContacts?: boolean;
};

export function StandardizedActivityTable({
  rows,
  showCompanyMatching = false,
  isSavedRecap = false,
  showContacts = false,
}: StandardizedActivityTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        No standardized rows match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead>SDR</TableHead>
            <TableHead>Date / Week</TableHead>
            <TableHead>Lead</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="text-center">LinkedIn</TableHead>
            <TableHead className="text-center">Email</TableHead>
            <TableHead className="text-center">Call</TableHead>
            <TableHead className="text-center">NPU</TableHead>
            <TableHead className="text-center">Not interested</TableHead>
            <TableHead className="text-center">Other</TableHead>
            <TableHead className="text-center">Total</TableHead>
            <TableHead>Note</TableHead>
            <TableHead>Review</TableHead>
            {showCompanyMatching ? (
              <>
                <TableHead>Company Match</TableHead>
                <TableHead className="text-center">Confidence</TableHead>
                <TableHead>Open Company</TableHead>
              </>
            ) : null}
            {showContacts ? (
              <>
                <TableHead>Contact</TableHead>
                <TableHead>Open Contact</TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 250).map((row) => (
            <TableRow key={`${row.rowIndex}-${row.leadName}-${row.companyName}`}>
              <TableCell className="font-medium text-slate-900">{row.sdrName}</TableCell>
              <TableCell className="text-xs text-slate-500">
                {row.activityDate || row.weekLabel || "-"}
              </TableCell>
              <TableCell>
                <div className="max-w-44 truncate font-medium text-slate-900">
                  {row.leadName || "Missing lead"}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-52 truncate font-medium text-slate-900">
                  {row.companyName || "Missing company"}
                </div>
                {row.website ? (
                  <div className="max-w-52 truncate text-xs text-slate-500">
                    {row.website}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="max-w-44 truncate text-xs text-slate-600">
                {row.title || "-"}
              </TableCell>
              <CountCell value={row.linkedinCount} label={row.linkedinStageNormalized} />
              <CountCell value={row.emailCount} label={row.emailStageNormalized} />
              <CountCell value={row.callCount} label={row.callStageNormalized} />
              <CountCell value={row.noPickupCount} />
              <CountCell value={row.notInterestedCount} />
              <CountCell value={row.otherChannelCount} label={row.otherChannelNormalized} />
              <TableCell className="text-center font-semibold">
                {row.totalActivityCount}
              </TableCell>
              <TableCell>
                <div className="line-clamp-2 max-w-72 text-xs leading-5 text-slate-600">
                  {row.noteCombined || "-"}
                </div>
              </TableCell>
              <TableCell>
                <PriorityBadge priority={row.managerReviewPriority} />
                {row.managerReviewItemId ? (
                  <div className="mt-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/manager-review/${row.managerReviewItemId}`}>
                        Open review
                      </Link>
                    </Button>
                  </div>
                ) : row.managerReviewFlag && isSavedRecap ? (
                  <div className="mt-1 text-[11px] text-slate-500">
                    Sync manager review to create queue item.
                  </div>
                ) : null}
              </TableCell>
              {showCompanyMatching ? (
                <>
                  <TableCell>
                    <CompanyMatchBadge row={row} isSavedRecap={isSavedRecap} />
                    {row.companyMatchReason ? (
                      <div className="mt-1 line-clamp-2 max-w-48 text-[11px] leading-4 text-slate-500">
                        {row.companyMatchReason}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-center text-sm text-slate-700">
                    {row.companyMatchConfidence !== undefined
                      ? `${row.companyMatchConfidence}%`
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {row.matchedCompanyRecordId ? (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/companies?search=${encodeURIComponent(
                            row.matchedCompanyName || row.companyName
                          )}`}
                        >
                          Open company
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500">-</span>
                    )}
                  </TableCell>
                </>
              ) : null}
              {showContacts ? (
                <>
                  <TableCell>
                    {row.contactRecordId ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Contact linked
                      </Badge>
                    ) : isSavedRecap ? (
                      <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-600">
                        No contact
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                        Available after save
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.contactRecordId ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/contacts/${row.contactRecordId}`}>
                          Open contact
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-500">-</span>
                    )}
                  </TableCell>
                </>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 250 ? (
        <div className="border-t bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Showing first 250 rows of {rows.length.toLocaleString()} matching rows.
        </div>
      ) : null}
    </div>
  );
}

function CompanyMatchBadge({
  row,
  isSavedRecap,
}: {
  row: StandardizedSdrActivityRow;
  isSavedRecap: boolean;
}) {
  if (!isSavedRecap) {
    return (
      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
        Available after save
      </Badge>
    );
  }

  const status = row.companyMatchStatus ?? "no_match";
  const className =
    status === "matched"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "suggested"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : status === "ambiguous"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-slate-200 bg-slate-100 text-slate-600";

  const label =
    status === "no_match" ? "No match" : status.replaceAll("_", " ");

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function CountCell({ value, label }: { value: number; label?: string }) {
  return (
    <TableCell className="text-center">
      <div className="font-semibold text-slate-900">{value}</div>
      {label && label !== "none" ? (
        <div className="text-[11px] text-slate-500">{label.replaceAll("_", " ")}</div>
      ) : null}
    </TableCell>
  );
}

export function PriorityBadge({
  priority,
}: {
  priority: StandardizedSdrActivityRow["managerReviewPriority"];
}) {
  const className =
    priority === "high"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : priority === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : priority === "low"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <Badge variant="outline" className={className}>
      {priority === "none" ? "No review" : priority}
    </Badge>
  );
}
