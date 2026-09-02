import type { CompanyMatchSummary } from "@/lib/activityRecaps/types";

export function summarizeCompanyMatches(
  rows: Array<{
    companyMatchStatus?: string | null;
    matchedCompanyRecordId?: string | null;
  }>
): CompanyMatchSummary {
  const matchedRows = rows.filter(
    (row) => row.companyMatchStatus === "matched"
  ).length;
  const suggestedRows = rows.filter(
    (row) => row.companyMatchStatus === "suggested"
  ).length;
  const ambiguousRows = rows.filter(
    (row) => row.companyMatchStatus === "ambiguous"
  ).length;
  const noMatchRows = rows.filter(
    (row) => !row.companyMatchStatus || row.companyMatchStatus === "no_match"
  ).length;

  return {
    totalRows: rows.length,
    matchedRows,
    suggestedRows,
    noMatchRows,
    ambiguousRows,
    matchRate: rows.length > 0 ? Math.round((matchedRows / rows.length) * 100) : 0,
  };
}
