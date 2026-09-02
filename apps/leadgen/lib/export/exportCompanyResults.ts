import { getLocalFeedbackKey, type LocalFeedbackExample } from "@/lib/feedback";
import type { CompanyScoreResult } from "@/lib/types";

export type ExportCompanyResultsInput = {
  results: CompanyScoreResult[];
  feedbackByCompany: Record<string, LocalFeedbackExample>;
  exportedAt?: Date;
};

const exportColumns = [
  "Company Name",
  "Website",
  "Company Country",
  "Predicted Type",
  "Predicted Score",
  "Predicted Qualification",
  "Predicted Confidence",
  "Predicted Reason",
  "Predicted Review State",
  "Has Local Feedback",
  "Final Type",
  "Final Score",
  "Final Qualification",
  "Reviewer Note",
  "Feedback Created At",
  "Exported At",
  "Source",
];

export function exportCompanyResultsToCsv({
  results,
  feedbackByCompany,
  exportedAt = new Date(),
}: ExportCompanyResultsInput) {
  const exportedAtIso = exportedAt.toISOString();
  const rows = results.map((result) => {
    const feedback = feedbackByCompany[getLocalFeedbackKey(result)];

    return [
      result.company_name,
      result.website,
      result.company_country,
      result.type,
      result.company_score,
      result.qualification,
      result.confidence,
      result.reason,
      result.review_state,
      feedback ? "true" : "false",
      feedback?.final_company_type ?? result.type,
      feedback?.final_company_score ?? result.company_score,
      feedback?.final_qualification ?? result.qualification,
      feedback?.final_note ?? "",
      feedback?.created_at ?? "",
      exportedAtIso,
      "local-browser",
    ];
  });

  return [exportColumns, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n");
}

export function getCompanyResultsExportFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `telestar-company-results-${year}-${month}-${day}.csv`;
}

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  const escapedText = text.replaceAll('"', '""');

  if (/[",\r\n]/.test(escapedText)) {
    return `"${escapedText}"`;
  }

  return escapedText;
}
