import { classifyImportProfile } from "./classifyImportProfile";
import type { V2ValidationResult } from "./types";

export function validateIngestionRow(input: {
  headers: string[];
  rawRowJson: Record<string, unknown>;
  parseErrors?: string[];
}): V2ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [...(input.parseErrors ?? [])];
  const nonEmptyValues = Object.values(input.rawRowJson).filter(
    (value) => String(value ?? "").trim() !== ""
  );

  if (input.headers.length === 0) {
    errors.push("missing_header");
  }

  if (nonEmptyValues.length === 0) {
    errors.push("empty_row");
  }

  const importProfile = classifyImportProfile({
    headers: input.headers,
    row: input.rawRowJson,
  });

  if (importProfile === "unknown_mixed") {
    warnings.push("import_profile_unknown_mixed");
  }

  if (!hasRecognizableEvidence(input.rawRowJson)) {
    errors.push("no_recognizable_company_contact_or_activity_fields");
  }

  return {
    ok: errors.length === 0,
    importProfile,
    warnings,
    errors,
    normalizedRowJson: {
      ...input.rawRowJson,
      schemaVersion: "v2.ingestion.normalized-row.v1",
      importProfile,
      hints: buildHints(input.rawRowJson),
      warnings,
    },
  };
}

function hasRecognizableEvidence(row: Record<string, unknown>) {
  const recognizedKeys = [
    "company",
    "website",
    "domain",
    "email",
    "contact",
    "linkedin",
    "activity",
    "stage",
    "meeting",
    "status",
  ];

  return Object.entries(row).some(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    const hasValue = String(value ?? "").trim() !== "";

    return (
      hasValue &&
      recognizedKeys.some((keyword) => normalizedKey.includes(keyword))
    );
  });
}

function buildHints(row: Record<string, unknown>) {
  return {
    companyName: pick(row, ["company", "company_name", "account_name", "company_name_cleaned"]),
    website: pick(row, ["website", "domain", "company_website"]),
    // Descriptive company fields (industry/size/revenue) — previously discarded; feed scoring + filters.
    companyIndustry: pick(row, ["company_industry", "industry"]),
    companyStaffCount: pick(row, ["company_staff_count_range", "company_staff_count", "employee_count", "company_size", "staff_count", "headcount"]),
    companyRevenue: pick(row, ["company_revenue", "revenue", "annual_revenue"]),
    contactCity: pick(row, ["contact_city", "city"]),
    contactDepartment: pick(row, ["department", "contact_department"]),
    contactSeniority: pick(row, ["seniority", "contact_seniority"]),
    contactEmail: pick(row, ["email", "contact_email", "work_email", "email_1", "email_2", "primary_email"]),
    contactName: pick(row, ["contact", "contact_name", "full_name", "contact_full_name", "name"]),
    // Person title — was absent entirely, so "Job Title" / "Position" columns never mapped.
    contactTitle: pick(row, ["title", "job_title", "jobtitle", "position", "role", "contact_title"]),
    // Person phone only. normalizeHeaderName collapses "ContactPhone1" -> "contactphone1" (no
    // underscore), so both forms are listed. The company switchboard is deliberately NOT here — it is
    // not the person's direct line (see enrichContact's public_company_phone_not_person_direct).
    contactPhone: pick(row, [
      "contact_phone", "contactphone1", "contact_phone_1", "contactphone2", "contact_phone_2",
      "mobile", "work_phone", "direct_phone", "phone",
    ]),
    companyPhone: pick(row, ["company_phone", "companyphone1", "company_phone_1", "switchboard"]),
    contactCountry: pick(row, ["contact_country", "country"]),
    companyCountry: pick(row, ["company_country"]),
    contactEmailValidation: pick(row, ["email_1_validation", "contact_email_validation", "email_validation", "email_status"]),
    linkedinUrl: pick(row, ["linkedin", "linkedin_url", "contact_linkedin", "contact_li_profile_url", "li_profile_url", "person_linkedin_url"]),
    activityStage: pick(row, ["stage", "activity", "email_stage", "call_stage"]),
  };
}

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}
