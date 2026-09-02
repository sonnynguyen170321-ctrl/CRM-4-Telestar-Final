import type { EnrichedCompanyRow } from "@/lib/server/companies/enrichedCompanies";

const csvHeaders = [
  "Company Name",
  "Website",
  "Company Country",
  "Company Industry",
  "Upload Job ID",
  "Source Row Index",
  "Predicted Type",
  "Final Type",
  "Predicted Score",
  "Final Score",
  "Predicted Qualification",
  "Final Qualification",
  "Confidence",
  "Reviewed",
  "Final Note",
  "Predicted Reason",
  "Summary",
  "Scoring Source",
  "Scoring Version",
  "Website Status",
  "Website Quality",
  "Website Summary",
  "Website Domain",
  "Signal Product",
  "Signal Service",
  "Signal Pricing",
  "Signal API",
  "Signal AI",
  "Signal Cloud",
  "Signal Data",
  "Signal Security",
  "Archived At",
  "Deleted At",
  "Feedback ID",
  "Feedback Created At",
] as const;

const aiCsvHeaders = [
  "ai_assessed",
  "ai_provider",
  "ai_model",
  "ai_prompt_version",
  "ai_qualification",
  "ai_company_type",
  "ai_score",
  "ai_confidence",
  "ai_reason",
  "ai_icp_segment",
  "ai_outreach_angle",
  "ai_agreement_status",
  "ai_cache_hit",
  "ai_assessed_at",
] as const;

type CsvHeader = (typeof csvHeaders)[number];
type AiCsvHeader = (typeof aiCsvHeaders)[number];

export function buildCompanyResultsCsv(
  companies: EnrichedCompanyRow[],
  options: { includeAi?: boolean } = {}
) {
  const headers = options.includeAi
    ? [...csvHeaders, ...aiCsvHeaders]
    : [...csvHeaders];
  const rows = companies.map((company) =>
    headers.map((header) => getCsvValue(company, header))
  );

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
}

function getCsvValue(
  company: EnrichedCompanyRow,
  header: CsvHeader | AiCsvHeader
) {
  if (isAiCsvHeader(header)) {
    return getAiCsvValue(company, header);
  }

  const feedback = company.latestFeedbackExample;
  const scoreResult = company.scoreResult;
  const research = company.websiteResearch;
  const signals = getSignalFlags(research?.signalsJson);

  const finalCompanyType =
    feedback?.finalCompanyType ?? scoreResult?.companyType ?? "";
  const finalCompanyScore =
    feedback?.finalCompanyScore ?? scoreResult?.companyScore ?? "";
  const finalQualification =
    feedback?.finalQualification ?? scoreResult?.qualification ?? "";

  const values: Record<(typeof csvHeaders)[number], unknown> = {
    "Company Name": company.companyName,
    Website: company.website,
    "Company Country": company.companyCountry,
    "Company Industry": company.companyIndustry,
    "Upload Job ID": company.uploadJobId,
    "Source Row Index": company.sourceRowIndex,
    "Predicted Type": scoreResult?.companyType,
    "Final Type": finalCompanyType,
    "Predicted Score": scoreResult?.companyScore,
    "Final Score": finalCompanyScore,
    "Predicted Qualification": scoreResult?.qualification,
    "Final Qualification": finalQualification,
    Confidence: scoreResult?.confidence,
    Reviewed: feedback ? "true" : "false",
    "Final Note": feedback?.finalNote,
    "Predicted Reason": scoreResult?.reason,
    Summary: scoreResult?.oneSentenceCompanySummary,
    "Scoring Source": scoreResult?.scoringSource,
    "Scoring Version": scoreResult?.scoringVersion,
    "Website Status": research?.status,
    "Website Quality": research?.quality,
    "Website Summary": research?.summary,
    "Website Domain": research?.normalizedDomain,
    "Signal Product": signals.hasProductSignal,
    "Signal Service": signals.hasServiceSignal,
    "Signal Pricing": signals.hasPricingSignal,
    "Signal API": signals.hasApiSignal,
    "Signal AI": signals.hasAiSignal,
    "Signal Cloud": signals.hasCloudSignal,
    "Signal Data": signals.hasDataSignal,
    "Signal Security": signals.hasSecuritySignal,
    "Archived At": company.archivedAt,
    "Deleted At": company.deletedAt,
    "Feedback ID": feedback?.id,
    "Feedback Created At": feedback?.createdAt,
  };

  return values[header];
}

function getAiCsvValue(company: EnrichedCompanyRow, header: AiCsvHeader) {
  const aiAssessment = company.latestAiAssessment;
  const rawAi = isRecord(aiAssessment?.rawResponseJson)
    ? aiAssessment?.rawResponseJson
    : null;
  const values: Record<AiCsvHeader, unknown> = {
    ai_assessed: aiAssessment ? "true" : "false",
    ai_provider: aiAssessment?.provider,
    ai_model: aiAssessment?.modelName,
    ai_prompt_version: aiAssessment?.promptVersion,
    ai_qualification: aiAssessment?.qualification,
    ai_company_type: aiAssessment?.companyType,
    ai_score: aiAssessment?.companyScore,
    ai_confidence: aiAssessment?.confidence,
    ai_reason: aiAssessment?.reason,
    ai_icp_segment:
      readString(rawAi, "icpSegment") ??
      company.latestIcpInsight?.targetCustomerSegment,
    ai_outreach_angle:
      readString(rawAi, "outreachAngle") ??
      company.latestIcpInsight?.sdrMessagingAngle,
    ai_agreement_status: buildAiAgreementStatus(company),
    ai_cache_hit: aiAssessment?.cacheHit,
    ai_assessed_at: aiAssessment?.createdAt,
  };

  return values[header];
}

function buildAiAgreementStatus(company: EnrichedCompanyRow) {
  const aiAssessment = company.latestAiAssessment;

  if (!aiAssessment) {
    return "no_ai_assessment";
  }

  const feedback = company.latestFeedbackExample;
  const scoreResult = company.scoreResult;
  const officialQualification =
    feedback?.finalQualification ?? scoreResult?.qualification ?? null;
  const officialCompanyType =
    feedback?.finalCompanyType ?? scoreResult?.companyType ?? null;
  const officialScore =
    feedback?.finalCompanyScore ?? scoreResult?.companyScore ?? null;

  if (
    officialQualification === aiAssessment.qualification &&
    officialCompanyType === aiAssessment.companyType &&
    typeof officialScore === "number" &&
    Math.abs(officialScore - aiAssessment.companyScore) <= 10
  ) {
    return "agree";
  }

  if (
    officialQualification !== aiAssessment.qualification ||
    (typeof officialScore === "number" &&
      Math.abs(officialScore - aiAssessment.companyScore) > 20)
  ) {
    return "major_disagreement";
  }

  return "minor_disagreement";
}

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue =
    value instanceof Date ? value.toISOString() : String(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes("\"") ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replaceAll("\"", "\"\"")}"`;
  }

  return stringValue;
}

function getSignalFlags(value: unknown) {
  if (!isRecord(value)) {
    return {
      hasProductSignal: false,
      hasServiceSignal: false,
      hasPricingSignal: false,
      hasApiSignal: false,
      hasAiSignal: false,
      hasCloudSignal: false,
      hasDataSignal: false,
      hasSecuritySignal: false,
    };
  }

  return {
    hasProductSignal: value.hasProductSignal === true,
    hasServiceSignal: value.hasServiceSignal === true,
    hasPricingSignal: value.hasPricingSignal === true,
    hasApiSignal: value.hasApiSignal === true,
    hasAiSignal: value.hasAiSignal === true,
    hasCloudSignal: value.hasCloudSignal === true,
    hasDataSignal: value.hasDataSignal === true,
    hasSecuritySignal: value.hasSecuritySignal === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAiCsvHeader(header: CsvHeader | AiCsvHeader): header is AiCsvHeader {
  return (aiCsvHeaders as readonly string[]).includes(header);
}

function readString(value: Record<string, unknown> | null, key: string) {
  const candidate = value?.[key];

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}
