import type {
  LeadWorkspaceAssessment,
  LeadWorkspaceAccountPreRank,
  LeadWorkspaceConfidenceBand,
  LeadWorkspaceRow,
  LeadWorkspaceQualification,
} from "./types";
import { resolveContactDisplayName } from "./resolveContactDisplayName";

export type LeadWorkspaceSqlRow = {
  leadAssignmentId: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  icpVersionId: string;
  icpVersionNumber: number;
  icpProfileName: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  companyWebsiteUrl: string | null;
  companyCountry: string | null;
  contactId: string | null;
  contactName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  hasVerifiedEmail: boolean | null;
  assignmentLevel: "COMPANY" | "CONTACT";
  workflowStatus: string;
  companyIntelligenceStatus: string | null;
  companyFactTokens: unknown;
  activeEnrollmentCount: number | bigint | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  latestAssessmentId: string | null;
  fitScore: number | null;
  confidence: unknown;
  qualification: string | null;
  accountPreRank: string | null;
  companyType: string | null;
  reason: string | null;
  oneSentenceCompanySummary: string | null;
  evidenceSnapshotJson: unknown;
  hardGateResultsJson: unknown;
  confidenceBreakdownJson: unknown;
  dataQualityJson: unknown;
  scoringSource: string | null;
  scoringVersion: string | null;
  inputFingerprint: string | null;
  icpRulesHash: string | null;
  previousAssessmentId: string | null;
  assessmentCreatedAt: Date | string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  assignedAt: Date | string | null;
  lastTouchAt: Date | string | null;
  lastTouchChannel: string | null;
  hasResolvedReview: boolean | null;
  linkedProjectCount: number | bigint | null;
  linkedIcpCount: number | bigint | null;
};

export type HardRuleAssessmentSqlRow = {
  id: string;
  fitScore: number;
  confidence: unknown;
  qualification: string;
  accountPreRank: string | null;
  companyType: string | null;
  reason: string;
  oneSentenceCompanySummary: string | null;
  evidenceSnapshotJson: unknown;
  hardGateResultsJson: unknown;
  confidenceBreakdownJson: unknown;
  dataQualityJson: unknown;
  scoringSource: string;
  scoringVersion: string;
  inputFingerprint: string;
  icpRulesHash: string | null;
  previousAssessmentId: string | null;
  createdAt: Date | string;
};

export function mapLeadWorkspaceRow(row: LeadWorkspaceSqlRow): LeadWorkspaceRow {
  return {
    leadAssignmentId: row.leadAssignmentId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    projectName: row.projectName,
    icpVersionId: row.icpVersionId,
    icpVersionNumber: Number(row.icpVersionNumber),
    icpProfileName: row.icpProfileName,
    companyId: row.companyId,
    companyName: row.companyName,
    companyDomain: row.companyDomain,
    companyWebsiteUrl: row.companyWebsiteUrl,
    companyCountry: row.companyCountry,
    contactId: row.contactId,
    contactName: row.contactName,
    contactDisplayName: row.contactId
      ? resolveContactDisplayName({
          fullName: row.contactName,
          firstName: row.contactFirstName,
          lastName: row.contactLastName,
          email: row.contactEmail,
          companyName: row.companyName,
        })
      : null,
    contactTitle: row.contactTitle,
    contactEmail: row.contactEmail,
    hasVerifiedEmail: row.hasVerifiedEmail === true,
    assignmentLevel: row.assignmentLevel,
    workflowStatus: row.workflowStatus,
    qualification: row.latestAssessmentId
      ? normalizeQualification(row.qualification)
      : "NOT_SCORED",
    accountPreRank: normalizeAccountPreRank(row.accountPreRank),
    companyIntelligenceStatus: row.companyIntelligenceStatus,
    companyFactTokens: readStringArray(row.companyFactTokens),
    activeEnrollmentCount: Number(row.activeEnrollmentCount ?? 0),
    sourceIngestionJobId: null,
    sourceIngestionRowId: null,
    ownerUserId: row.ownerUserId ?? null,
    ownerName: row.ownerName ?? null,
    assignedAt: row.assignedAt ? toIsoString(row.assignedAt) : null,
    lastTouchAt: row.lastTouchAt ? toIsoString(row.lastTouchAt) : null,
    lastTouchChannel: row.lastTouchChannel ?? null,
    meetingStatus:
      row.workflowStatus === "MEETING_DONE"
        ? "DONE"
        : row.workflowStatus === "MEETING_BOOKED"
          ? "BOOKED"
          : "NONE",
    reviewStatus: row.hasResolvedReview === true ? "REVIEWED" : "NOT_REVIEWED",
    linkedProjectCount: Number(row.linkedProjectCount ?? 0),
    linkedIcpCount: Number(row.linkedIcpCount ?? 0),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    latestAssessment: row.latestAssessmentId
      ? mapAssessmentRow({
          id: row.latestAssessmentId,
          fitScore: Number(row.fitScore ?? 0),
          confidence: row.confidence,
          qualification: row.qualification ?? "NEEDS_REVIEW",
          accountPreRank: row.accountPreRank,
          companyType: row.companyType,
          reason: row.reason ?? "",
          oneSentenceCompanySummary: row.oneSentenceCompanySummary,
          evidenceSnapshotJson: row.evidenceSnapshotJson,
          hardGateResultsJson: row.hardGateResultsJson,
          confidenceBreakdownJson: row.confidenceBreakdownJson,
          dataQualityJson: row.dataQualityJson,
          scoringSource: row.scoringSource ?? "",
          scoringVersion: row.scoringVersion ?? "",
          inputFingerprint: row.inputFingerprint ?? "",
          icpRulesHash: row.icpRulesHash,
          previousAssessmentId: row.previousAssessmentId,
          createdAt: row.assessmentCreatedAt ?? row.updatedAt,
        })
      : null,
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function mapAssessmentRow(
  row: HardRuleAssessmentSqlRow
): LeadWorkspaceAssessment {
  const confidence = toNumber(row.confidence);
  const confidenceScore = readConfidenceScore(row.confidenceBreakdownJson);

  return {
    id: row.id,
    fitScore: Number(row.fitScore),
    confidence,
    confidenceScore,
    confidenceBand: readConfidenceBand(row.confidenceBreakdownJson, confidence),
    qualification: normalizeQualification(row.qualification),
    accountPreRank: normalizeAccountPreRank(row.accountPreRank),
    companyType: row.companyType,
    reason: row.reason,
    oneSentenceCompanySummary: row.oneSentenceCompanySummary,
    evidenceSnapshotJson: row.evidenceSnapshotJson,
    hardGateResultsJson: row.hardGateResultsJson,
    confidenceBreakdownJson: row.confidenceBreakdownJson,
    dataQualityJson: row.dataQualityJson,
    scoringSource: row.scoringSource,
    scoringVersion: row.scoringVersion,
    inputFingerprint: row.inputFingerprint,
    icpRulesHash: row.icpRulesHash,
    previousAssessmentId: row.previousAssessmentId,
    createdAt: toIsoString(row.createdAt),
  };
}

function normalizeQualification(value: string | null): LeadWorkspaceQualification {
  if (
    value === "QUALIFIED" ||
    value === "NEEDS_REVIEW" ||
    value === "UNQUALIFIED" ||
    value === "COMPANY_QUALIFIED_NEEDS_CONTACT" ||
    value === "NOT_SCORED"
  ) {
    return value;
  }

  return "NEEDS_REVIEW";
}

function normalizeAccountPreRank(value: string | null): LeadWorkspaceAccountPreRank | null {
  if (
    value === "STRONG_ACCOUNT_FIT" ||
    value === "POSSIBLE_ACCOUNT_FIT" ||
    value === "WEAK_FIT" ||
    value === "CLEAR_MISMATCH"
  ) {
    return value;
  }

  return null;
}

function readConfidenceScore(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const score = (value as { confidenceScore?: unknown }).confidenceScore;

  return typeof score === "number" ? score : null;
}

function readConfidenceBand(
  value: unknown,
  confidence: number
): LeadWorkspaceConfidenceBand {
  if (value && typeof value === "object") {
    const band = (value as { confidence?: unknown }).confidence;

    if (band === "HIGH" || band === "MEDIUM" || band === "LOW") {
      return band;
    }
  }

  if (confidence >= 0.75) {
    return "HIGH";
  }

  if (confidence >= 0.45) {
    return "MEDIUM";
  }

  return "LOW";
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }

  return Number(value ?? 0);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
