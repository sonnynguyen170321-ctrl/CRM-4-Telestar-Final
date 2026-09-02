import type {
  LeadWorkspaceAssignmentLevel,
  LeadWorkspaceConfidenceBand,
  LeadWorkspaceFilters,
  LeadWorkspaceQualification,
  LeadWorkspaceScoredFilter,
} from "./types";

const VALID_ASSIGNMENT_LEVELS = new Set(["COMPANY", "CONTACT"]);
const VALID_QUALIFICATIONS = new Set([
  "QUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
  "NEEDS_REVIEW",
  "UNQUALIFIED",
  "NOT_SCORED",
]);
const VALID_SCORED = new Set(["scored", "unscored"]);
const VALID_CONFIDENCE_BANDS = new Set(["HIGH", "MEDIUM", "LOW"]);
const VALID_CONTACT_READINESS = new Set(["has_email", "missing_email", "ready", "review", "linkedin_only", "company_phone", "missing"]);
const VALID_ENROLLMENT = new Set(["enrolled", "not_enrolled"]);
const VALID_INTELLIGENCE_STATUS = new Set([
  "EXTRACTED",
  "PARTIAL",
  "FAILED",
  "PLACEHOLDER",
  "MISSING",
]);
const VALID_WORKFLOW_STATUSES = new Set([
  "NEW",
  "ASSIGNED",
  "WORKING",
  "CONTACTED",
  "RESPONDED",
  "MEETING_BOOKED",
  "MEETING_DONE",
  "NURTURE",
  "NOT_INTERESTED",
  "BOUNCED",
  "SUPPRESSED",
  "DISQUALIFIED",
  "ARCHIVED",
]);

export type SearchParamRecord = Record<string, string | string[] | undefined>;

export function parseLeadWorkspaceFilters(
  params: SearchParamRecord
): LeadWorkspaceFilters {
  const assignmentLevel = getSearchParam(params, "assignmentLevel");
  const scored = getSearchParam(params, "scored");
  const contactReadiness = getSearchParam(params, "contactReadiness");
  const enrollment = getSearchParam(params, "enrollment");

  return {
    clientAccountId: getSearchParam(params, "clientAccountId"),
    projectId: getSearchParam(params, "projectId"),
    icpVersionId: getSearchParam(params, "icpVersionId"),
    companyId: getSearchParam(params, "companyId"),
    workflowStatus: getArrayParam(params, "workflowStatus", VALID_WORKFLOW_STATUSES),
    excludeWorkflowStatus: getArrayParam(params, "excludeWorkflowStatus", VALID_WORKFLOW_STATUSES),
    qualification: getArrayParam(params, "qualification", VALID_QUALIFICATIONS) as LeadWorkspaceQualification[],
    excludeQualification: getArrayParam(params, "excludeQualification", VALID_QUALIFICATIONS) as LeadWorkspaceQualification[],
    assignmentLevel:
      assignmentLevel && VALID_ASSIGNMENT_LEVELS.has(assignmentLevel)
        ? (assignmentLevel as LeadWorkspaceAssignmentLevel)
        : undefined,
    scored:
      scored && VALID_SCORED.has(scored)
        ? (scored as LeadWorkspaceScoredFilter)
        : undefined,
    confidenceBand: getArrayParam(params, "confidenceBand", VALID_CONFIDENCE_BANDS) as LeadWorkspaceConfidenceBand[],
    country: getArrayParam(params, "country"),
    excludeCountry: getArrayParam(params, "excludeCountry"),
    domain: getSearchParam(params, "domain"),
    createdFrom: sanitizeDateParam(getSearchParam(params, "createdFrom")),
    createdTo: sanitizeDateParam(getSearchParam(params, "createdTo")),
    search: getSearchParam(params, "search"),
    contactReadiness:
      contactReadiness && VALID_CONTACT_READINESS.has(contactReadiness)
        ? (contactReadiness as LeadWorkspaceFilters["contactReadiness"])
        : undefined,
    enrollment:
      enrollment && VALID_ENROLLMENT.has(enrollment)
        ? (enrollment as LeadWorkspaceFilters["enrollment"])
        : undefined,
    intelligenceStatus: getArrayParam(params, "intelligenceStatus", VALID_INTELLIGENCE_STATUS) as Array<"EXTRACTED" | "PARTIAL" | "FAILED" | "PLACEHOLDER" | "MISSING">,
    excludeIntelligenceStatus: getArrayParam(params, "excludeIntelligenceStatus", VALID_INTELLIGENCE_STATUS) as Array<"EXTRACTED" | "PARTIAL" | "FAILED" | "PLACEHOLDER" | "MISSING">,
    factToken: getArrayParam(params, "factToken"),
    excludeFactToken: getArrayParam(params, "excludeFactToken"),
    servedVertical: getArrayParam(params, "servedVertical"),
  };
}

// Accept only a plain calendar date (YYYY-MM-DD) so the value is a safe, valid timestamptz cast.
function sanitizeDateParam(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : value;
}

export function hasFullLeadWorkspaceContext(filters: LeadWorkspaceFilters) {
  return Boolean(
    filters.clientAccountId && filters.projectId && filters.icpVersionId
  );
}

export function toLeadWorkspaceQueryRecord(params: SearchParamRecord) {
  const query: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === "organizationId") {
      continue;
    }

    const val = value;

    if (Array.isArray(val)) {
      query[key] = val.join(",");
    } else if (val && val.trim()) {
      query[key] = val.trim();
    }
  }

  return query;
}

export function buildLeadWorkspaceExportHref(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  params.delete("page");
  params.delete("pageSize");
  params.delete("selectedLeadId");

  const queryString = params.toString();

  return queryString ? `/v2/workspace/leads/export?${queryString}` : "/v2/workspace/leads/export";
}

export function getSearchParam(params: SearchParamRecord, key: string) {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;

  return first?.trim() || undefined;
}

export function getArrayParam(params: SearchParamRecord, key: string, validSet?: Set<string>): string[] | undefined {
  const value = params[key];
  if (!value) return undefined;

  // Convert standard string to array, or comma-separated string to array
  const rawArray = Array.isArray(value) ? value : value.split(",");

  const parsed = rawArray
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => (validSet ? validSet.has(v) : true));

  return parsed.length > 0 ? parsed : undefined;
}
