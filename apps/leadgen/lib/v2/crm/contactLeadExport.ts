import {
  queryContactLeads,
  type ContactLeadRow,
  type ContactLeadsDb,
  type ContactLeadsFilters,
  type ContactLeadsResult,
} from "./queryContactLeads";
import type { LeadExportOverlay } from "./exportLeadWorkspace";

const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_ROWS = 100_000;

export type CollectContactLeadExportDeps = {
  fetchPage?: (
    input: {
      organizationId: string;
      page: number;
      pageSize: number;
      filters: ContactLeadsFilters;
    },
    db?: ContactLeadsDb
  ) => Promise<ContactLeadsResult>;
  db?: ContactLeadsDb;
};

export async function collectContactLeadExportRows(
  input: { organizationId: string; filters: ContactLeadsFilters },
  deps: CollectContactLeadExportDeps = {}
): Promise<{ rows: ContactLeadRow[]; total: number }> {
  const fetchPage = deps.fetchPage ?? queryContactLeads;
  const rows: ContactLeadRow[] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const result = await fetchPage(
      {
        organizationId: input.organizationId,
        page,
        pageSize: EXPORT_PAGE_SIZE,
        filters: input.filters,
      },
      deps.db
    );
    total = result.pagination.total;
    rows.push(...result.rows);

    if (
      result.rows.length === 0 ||
      rows.length >= total ||
      rows.length >= EXPORT_MAX_ROWS ||
      page >= result.pagination.totalPages
    ) {
      break;
    }
    page += 1;
  }

  return { rows, total };
}

export const CONTACT_LEAD_EXPORT_COLUMNS = [
  "contactId",
  "contactName",
  "contactTitle",
  "email",
  "emailUsable",
  "emailValidityStatus",
  "emailIsGeneric",
  "emailSource",
  "phone",
  "phoneValidityStatus",
  "phoneSource",
  "linkedInUrl",
  "seniorityTier",
  "department",
  "contactCity",
  "contactCountry",
  "source",
  "contactabilityStatus",
  "contactabilityPrimaryChannel",
  "leadAssignmentId",
  "companyName",
  "companyDomain",
  "companyCountry",
  "projectName",
  "icpProfileName",
  "icpVersionNumber",
  "workflowStatus",
  "qualification",
  "accountPreRank",
  "fitScore",
  "confidence",
  "latestAssessmentId",
  "scoringVersion",
  "inputFingerprint",
  "icpRulesHash",
  "assessmentCreatedAt",
  "activeEnrollmentCount",
  "openReviewCount",
  "feedbackCount",
] as const;

export function serializeContactLeadCsv(
  rows: ContactLeadRow[],
  overlay: LeadExportOverlay = new Map()
): string {
  const lines = [CONTACT_LEAD_EXPORT_COLUMNS.map(csvCell).join(",")];

  for (const row of rows) {
    const humanOverlay = overlay.get(row.leadAssignmentId);
    const values = [
      row.contactId,
      row.contactName,
      row.contactTitle ?? "",
      row.email ?? "",
      String(row.emailUsable),
      row.emailValidityStatus ?? "",
      String(row.emailIsGeneric),
      row.emailSource ?? "",
      row.phone ?? "",
      row.phoneValidityStatus ?? "",
      row.phoneSource ?? "",
      row.linkedInUrl ?? "",
      row.seniorityTier,
      row.department,
      row.contactCity ?? "",
      row.contactCountry ?? "",
      row.source ?? "",
      row.contactabilityStatus,
      row.contactabilityPrimaryChannel,
      row.leadAssignmentId,
      row.companyName,
      row.companyDomain ?? "",
      row.companyCountry ?? "",
      row.projectName,
      row.icpProfileName,
      String(row.icpVersionNumber),
      row.workflowStatus,
      row.qualification,
      row.accountPreRank ?? "",
      row.fitScore === null ? "" : String(row.fitScore),
      row.confidence === null ? "" : String(row.confidence),
      row.latestAssessmentId ?? "",
      row.scoringVersion ?? "",
      row.inputFingerprint ?? "",
      row.icpRulesHash ?? "",
      row.assessmentCreatedAt ?? "",
      String(row.activeEnrollmentCount),
      String(humanOverlay?.openReviewCount ?? 0),
      String(humanOverlay?.feedbackCount ?? 0),
    ];
    lines.push(values.map(csvCell).join(","));
  }

  return lines.join("\r\n");
}

function csvCell(value: unknown): string {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}
